-- Week 4 Thinking of You.
--
-- Additive on top of 20261026120000_circles_and_invites.sql.
-- Safe to run once against a database that already has weeks 1–3.
-- Do not edit or re-run those files.
--
-- This adds public.pings. A row is a gesture, not a message.
--   * to_user_id set: only the sender and that recipient can read it
--   * to_user_id null: every active member can read it (a whole-circle ping)
--
-- The app does not send whole-circle pings yet. The column and the read
-- policy are here so a later group phase does not need a new shape. A couple
-- cannot insert a null recipient. That check lives in the insert trigger,
-- not in a policy, because circle_type is a default and must not appear in RLS.
--
-- push_subscriptions is unchanged. It is still one row per device, owner-only.
-- The app reads the recipient's rows with the secret key, sends to each, and
-- deletes a row when the push service returns 404 or 410.

-- ---------------------------------------------------------------------------
-- pings
-- ---------------------------------------------------------------------------

create table public.pings (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- Null after the sender's account is deleted ("Former member").
  -- Do not use null here to mean "everyone". That meaning belongs to to_user_id.
  from_user_id uuid references public.profiles (id) on delete set null,
  -- Null means every active member of the circle.
  -- on delete cascade, not set null: deleting the recipient must not turn a
  -- private ping into a whole-circle ping.
  to_user_id uuid references public.profiles (id) on delete cascade,
  -- mood-share is accepted so a later week can insert it. This app only
  -- writes thinking-of-you.
  ping_type text not null default 'thinking-of-you',
  mood_emoji text,
  -- Missing<name>. The lock-screen text stays generic; the name is in the app.
  secret_variant boolean not null default false,
  sent_at timestamptz not null default now(),
  constraint pings_type_known check (
    ping_type in ('thinking-of-you', 'mood-share')
  ),
  constraint pings_mood_emoji_shape check (
    mood_emoji is null
    or (
      char_length(mood_emoji) between 1 and 32
      and position('@' in mood_emoji) = 0
    )
  ),
  constraint pings_thinking_has_no_mood check (
    ping_type <> 'thinking-of-you' or mood_emoji is null
  ),
  constraint pings_mood_share_has_emoji check (
    ping_type <> 'mood-share' or mood_emoji is not null
  ),
  constraint pings_not_self check (
    to_user_id is null or from_user_id is distinct from to_user_id
  )
);

comment on table public.pings is
  'A gesture inside a circle. Sender and recipient can read a 1:1 row. to_user_id null is a whole-circle ping and is not sent by the app yet.';

comment on column public.pings.to_user_id is
  'The partner in a couple. Null means every active member. Null is rejected for a couple by the insert trigger.';

comment on column public.pings.secret_variant is
  'True when the gesture is the Missing<name> variant. The push text does not include the name.';

create index pings_circle_sent_idx
  on public.pings (circle_id, sent_at desc);

create index pings_sender_sent_idx
  on public.pings (from_user_id, sent_at desc);

alter table public.pings enable row level security;

revoke all on table public.pings from public, anon, authenticated;

grant select on table public.pings to authenticated;

-- sent_at is not granted. The trigger stamps it, so a client cannot backdate
-- a row to slip past the rate limit.
grant insert (
  circle_id,
  from_user_id,
  to_user_id,
  ping_type,
  mood_emoji,
  secret_variant
) on table public.pings to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when `member` has a live row in circle `c`. security definer so the
-- insert policy can see that membership without depending on the caller's
-- own circle_members policy. Not in the Data API (private schema).
create function private.is_active_member_user(c uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select member is not null
     and exists (
       select 1
       from public.circle_members
       where circle_id = c
         and user_id = member
         and left_at is null
     );
$$;

revoke all on function private.is_active_member_user(uuid, uuid)
  from public, anon, authenticated;

grant execute on function private.is_active_member_user(uuid, uuid)
  to authenticated;

comment on function private.is_active_member_user(uuid, uuid) is
  'True when member has a circle_members row in c with left_at null.';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
--
-- The circle's type is not read here. Active member means private.is_active_member.
-- There is no update policy and no delete policy. A ping is not edited.

create policy pings_select_parties
  on public.pings
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
      or to_user_id is null
    )
  );

comment on policy pings_select_parties on public.pings is
  'Sender, recipient, or — when to_user_id is null — any active member. An outsider fails is_active_member. A third member fails the party check on a 1:1 row.';

create policy pings_insert_sender
  on public.pings
  for insert
  to authenticated
  with check (
    from_user_id = (select auth.uid())
    and private.is_active_member(circle_id)
    and (
      (
        to_user_id is not null
        and to_user_id is distinct from (select auth.uid())
        and private.is_active_member_user(circle_id, to_user_id)
      )
      or to_user_id is null
    )
  );

comment on policy pings_insert_sender on public.pings is
  'You insert as yourself, to another active member, or with a null recipient. A couple null is rejected by the trigger, not by this policy.';

-- ---------------------------------------------------------------------------
-- Insert guard
-- ---------------------------------------------------------------------------
--
-- Two jobs the policy must not do:
--   * reject to_user_id null when the circle is a couple (uses circle_type)
--   * cap how many pings one person can send
--
-- The cap is 10 pings in 10 minutes, counted across every circle. Week 5
-- replaces this with Upstash. The advisory lock makes two overlapping taps
-- share one count. sent_at is always the database clock.

create function private.pings_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_type text;
  recent integer;
begin
  if new.from_user_id is null then
    raise exception 'hsummer_missing_sender';
  end if;

  if new.to_user_id is null then
    select circle_type
      into found_type
    from public.circles
    where id = new.circle_id;

    if not found then
      raise exception 'hsummer_missing_circle';
    end if;

    if found_type = 'couple' then
      raise exception 'hsummer_couple_needs_recipient';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.from_user_id::text, 0)
  );

  select count(*)::integer
    into recent
  from public.pings
  where from_user_id = new.from_user_id
    and sent_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 10 then
    raise exception 'hsummer_rate_limited';
  end if;

  new.sent_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.pings_guard_insert()
  from public, anon, authenticated;

create trigger pings_guard_insert
  before insert on public.pings
  for each row
  execute function private.pings_guard_insert();

comment on function private.pings_guard_insert() is
  'Rejects a whole-circle ping in a couple, stamps sent_at, and allows 10 pings per 10 minutes per sender.';
