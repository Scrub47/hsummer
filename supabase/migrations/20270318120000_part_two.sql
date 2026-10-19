-- Part 2: keepsakes, reactions, replies, and quiet-hour status.
--
-- Additive on top of 20270301120000_security_audit_v2.sql.
-- Safe to run more than once. Nothing earlier is edited.
-- Isaac pastes this file into the Supabase SQL editor.
--
--   * letter_pins — a personal Keepsakes shelf. Only the person who
--     pinned a letter can see that pin, and only while they can still
--     read the letter.
--   * reactions and replies — a small emoji set and a short note on a
--     letter or a memory (photos and strips are memories). Visible only
--     to someone who can already read that item.
--   * held_notifications — pings the app holds until quiet hours end.
--     Authenticated clients cannot read or write it. The service role
--     does, from the server.
--   * recipient_quiet_status(target, at) — a circle member can ask
--     whether someone they share a circle with is in quiet hours at a
--     moment (default now()), and the clock time the hold ends. It does
--     not return the rest of their settings.
--
-- Quiet hours themselves live in account_private.notification_prefs,
-- which stays owner-only. The send path reads that row with the service
-- role and refuses to push until the window ends.

-- ---------------------------------------------------------------------------
-- letter_pins
-- ---------------------------------------------------------------------------

create table if not exists public.letter_pins (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint letter_pins_one unique (letter_id, user_id)
);

comment on table public.letter_pins is
  'A personal pin on a letter the person can already read. Other members do not see the pin.';

alter table public.letter_pins enable row level security;

revoke all on table public.letter_pins from public, anon, authenticated;

grant select on table public.letter_pins to authenticated;

grant insert (letter_id, user_id, circle_id)
  on table public.letter_pins to authenticated;

grant delete on table public.letter_pins to authenticated;

grant select, insert, update, delete on table public.letter_pins to service_role;

create index if not exists letter_pins_user_idx
  on public.letter_pins (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Who can read a letter
-- ---------------------------------------------------------------------------

create or replace function private.can_read_letter(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.letters as letter
    where letter.id = target
      and private.is_active_member(letter.circle_id)
      and (
        letter.from_user_id = (select auth.uid())
        or (
          letter.to_user_id = (select auth.uid())
          and letter.delivered_at is not null
        )
      )
  );
$$;

revoke all on function private.can_read_letter(uuid)
  from public, anon, authenticated;

grant execute on function private.can_read_letter(uuid) to authenticated;

comment on function private.can_read_letter(uuid) is
  'True for the sender, or the recipient once the letter is delivered. A third member and a former member are false.';

-- ---------------------------------------------------------------------------
-- letter_pins policies and guard
-- ---------------------------------------------------------------------------

drop policy if exists letter_pins_select_own on public.letter_pins;
create policy letter_pins_select_own
  on public.letter_pins
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.can_read_letter(letter_id)
  );

comment on policy letter_pins_select_own on public.letter_pins is
  'You see your own pins, and only while you can still read the letter.';

drop policy if exists letter_pins_insert_own on public.letter_pins;
create policy letter_pins_insert_own
  on public.letter_pins
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_read_letter(letter_id)
  );

comment on policy letter_pins_insert_own on public.letter_pins is
  'You pin a letter as yourself, and only one you can read.';

drop policy if exists letter_pins_delete_own on public.letter_pins;
create policy letter_pins_delete_own
  on public.letter_pins
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on policy letter_pins_delete_own on public.letter_pins is
  'You can take your own pin off. Nobody else can.';

create or replace function private.letter_pins_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_circle uuid;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if (select auth.uid()) is null then
    raise exception 'hsummer_pin';
  end if;

  new.user_id := (select auth.uid());
  new.created_at := pg_catalog.now();

  select letter.circle_id
    into found_circle
  from public.letters as letter
  where letter.id = new.letter_id;

  if found_circle is null or found_circle is distinct from new.circle_id then
    raise exception 'hsummer_pin';
  end if;

  if not private.can_read_letter(new.letter_id) then
    raise exception 'hsummer_pin';
  end if;

  return new;
end;
$$;

revoke all on function private.letter_pins_guard()
  from public, anon, authenticated;

drop trigger if exists letter_pins_guard on public.letter_pins;
create trigger letter_pins_guard
  before insert on public.letter_pins
  for each row
  execute function private.letter_pins_guard();

comment on function private.letter_pins_guard() is
  'Stamps the pinner and rejects a pin on a letter in another circle or one they cannot read.';

-- ---------------------------------------------------------------------------
-- Shared visibility for a reaction or a reply
-- ---------------------------------------------------------------------------

create or replace function private.can_respond_to(
  kind text,
  target uuid,
  circle uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when kind = 'letter' then
      private.can_read_letter(target)
      and exists (
        select 1
        from public.letters as letter
        where letter.id = target
          and letter.circle_id = circle
      )
    when kind = 'memory' then
      private.can_read_memory(target)
      and exists (
        select 1
        from public.memories as memory
        where memory.id = target
          and memory.circle_id = circle
      )
    else false
  end;
$$;

revoke all on function private.can_respond_to(text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function private.can_respond_to(text, uuid, uuid)
  to authenticated;

comment on function private.can_respond_to(text, uuid, uuid) is
  'True when the signed-in person can read that letter or memory and it belongs to the named circle. Photos and strips are memories.';

-- ---------------------------------------------------------------------------
-- reactions
-- ---------------------------------------------------------------------------

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint reactions_kind_known check (target_kind in ('letter', 'memory')),
  constraint reactions_emoji_known check (
    emoji in ('heart', 'adore', 'hug', 'spark', 'letter')
  ),
  constraint reactions_one unique (user_id, target_kind, target_id, emoji)
);

comment on table public.reactions is
  'One cozy reaction on a letter or a memory. Readable only by people who can see that item.';

comment on column public.reactions.emoji is
  'heart, adore, hug, spark, or letter. The app draws the emoji.';

alter table public.reactions enable row level security;

revoke all on table public.reactions from public, anon, authenticated;

grant select on table public.reactions to authenticated;

grant insert (circle_id, user_id, target_kind, target_id, emoji)
  on table public.reactions to authenticated;

grant delete on table public.reactions to authenticated;

grant select, insert, update, delete on table public.reactions to service_role;

create index if not exists reactions_target_idx
  on public.reactions (target_kind, target_id);

drop policy if exists reactions_select_visible on public.reactions;
create policy reactions_select_visible
  on public.reactions
  for select
  to authenticated
  using (private.can_respond_to(target_kind, target_id, circle_id));

comment on policy reactions_select_visible on public.reactions is
  'A person sees reactions on items they can already read. A third member of a 1:1 letter, and a former member, get nothing.';

drop policy if exists reactions_insert_self on public.reactions;
create policy reactions_insert_self
  on public.reactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_respond_to(target_kind, target_id, circle_id)
  );

comment on policy reactions_insert_self on public.reactions is
  'You react as yourself, on something you can read.';

drop policy if exists reactions_delete_self on public.reactions;
create policy reactions_delete_self
  on public.reactions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on policy reactions_delete_self on public.reactions is
  'You can take your own reaction off.';

create or replace function private.reactions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent integer;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if actor is null then
    raise exception 'hsummer_reaction';
  end if;

  new.user_id := actor;
  new.created_at := pg_catalog.now();

  if not private.can_respond_to(new.target_kind, new.target_id, new.circle_id) then
    raise exception 'hsummer_reaction';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hsummer-reaction-rate:' || actor::text,
      0
    )
  );

  select count(*)::integer
    into recent
  from public.reactions
  where user_id = actor
    and created_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 30 then
    raise exception 'hsummer_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function private.reactions_guard()
  from public, anon, authenticated;

drop trigger if exists reactions_guard on public.reactions;
create trigger reactions_guard
  before insert on public.reactions
  for each row
  execute function private.reactions_guard();

comment on function private.reactions_guard() is
  'Stamps the author and allows 30 reactions per 10 minutes. Upstash applies the same cap in front of this.';

-- ---------------------------------------------------------------------------
-- replies
-- ---------------------------------------------------------------------------

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  target_kind text not null,
  target_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint replies_kind_known check (target_kind in ('letter', 'memory')),
  constraint replies_body_shape check (
    char_length(btrim(body)) between 1 and 280
    and position('@' in body) = 0
    and octet_length(body) <= 1120
  )
);

comment on table public.replies is
  'A short reply on a letter or a memory. Readable only by people who can see that item. No email addresses.';

alter table public.replies enable row level security;

revoke all on table public.replies from public, anon, authenticated;

grant select on table public.replies to authenticated;

grant insert (circle_id, user_id, target_kind, target_id, body)
  on table public.replies to authenticated;

grant delete on table public.replies to authenticated;

grant select, insert, update, delete on table public.replies to service_role;

create index if not exists replies_target_idx
  on public.replies (target_kind, target_id, created_at);

drop policy if exists replies_select_visible on public.replies;
create policy replies_select_visible
  on public.replies
  for select
  to authenticated
  using (private.can_respond_to(target_kind, target_id, circle_id));

comment on policy replies_select_visible on public.replies is
  'A person sees replies on items they can already read. A third member of a 1:1 letter, and a former member, get nothing.';

drop policy if exists replies_insert_self on public.replies;
create policy replies_insert_self
  on public.replies
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.can_respond_to(target_kind, target_id, circle_id)
  );

comment on policy replies_insert_self on public.replies is
  'You reply as yourself, on something you can read.';

drop policy if exists replies_delete_self on public.replies;
create policy replies_delete_self
  on public.replies
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

comment on policy replies_delete_self on public.replies is
  'You can remove your own reply.';

create or replace function private.replies_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent integer;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if actor is null then
    raise exception 'hsummer_reply';
  end if;

  new.user_id := actor;
  new.created_at := pg_catalog.now();
  new.body := pg_catalog.btrim(new.body);

  if not private.can_respond_to(new.target_kind, new.target_id, new.circle_id) then
    raise exception 'hsummer_reply';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hsummer-reply-rate:' || actor::text,
      0
    )
  );

  select count(*)::integer
    into recent
  from public.replies
  where user_id = actor
    and created_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 20 then
    raise exception 'hsummer_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function private.replies_guard()
  from public, anon, authenticated;

drop trigger if exists replies_guard on public.replies;
create trigger replies_guard
  before insert on public.replies
  for each row
  execute function private.replies_guard();

comment on function private.replies_guard() is
  'Stamps the author, trims the note, and allows 20 replies per 10 minutes.';

-- ---------------------------------------------------------------------------
-- held_notifications
-- ---------------------------------------------------------------------------

create table if not exists public.held_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  kind text not null,
  ref_id uuid not null,
  deliver_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint held_notifications_kind_known check (kind in ('ping')),
  constraint held_notifications_one unique (kind, ref_id, user_id)
);

comment on table public.held_notifications is
  'A ping push held until the recipient''s quiet hours end. Clients cannot read or write this table.';

alter table public.held_notifications enable row level security;

revoke all on table public.held_notifications from public, anon, authenticated;

grant select, insert, update, delete
  on table public.held_notifications to service_role;

create index if not exists held_notifications_due_idx
  on public.held_notifications (deliver_at)
  where delivered_at is null;

-- No policies. Authenticated and anon are denied. The service role bypasses RLS.

-- ---------------------------------------------------------------------------
-- Quiet hours, asked by a circle member
-- ---------------------------------------------------------------------------

-- Adding `at` is a new signature. Drop both shapes so a second paste,
-- and a database that already has the one-argument function, end on one function.
drop function if exists public.recipient_quiet_status(uuid);
drop function if exists public.recipient_quiet_status(uuid, timestamptz);

create or replace function public.recipient_quiet_status(
  target uuid,
  at timestamptz default pg_catalog.now()
)
returns table (
  in_quiet boolean,
  resume_label text,
  pings_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prefs jsonb;
  zone text;
  quiet jsonb;
  enabled boolean;
  start_text text;
  end_text text;
  start_min integer;
  end_min integer;
  local_ts timestamp;
  minutes integer;
  quiet_now boolean;
  hour_part integer;
  minute_part integer;
  hour_12 integer;
  moment timestamptz;
begin
  moment := coalesce(at, pg_catalog.now());
  if (select auth.uid()) is null then
    return;
  end if;

  if (select auth.uid()) is distinct from target
     and not exists (
       select 1
       from public.circle_members as me
       join public.circle_members as them
         on them.circle_id = me.circle_id
       where me.user_id = (select auth.uid())
         and me.left_at is null
         and them.user_id = target
         and them.left_at is null
     )
  then
    return;
  end if;

  select account.notification_prefs, profile.timezone
    into prefs, zone
  from public.account_private as account
  join public.profiles as profile on profile.id = account.user_id
  where account.user_id = target;

  pings_enabled := true;
  in_quiet := false;
  resume_label := null;

  if prefs is null or pg_catalog.jsonb_typeof(prefs) is distinct from 'object' then
    return next;
    return;
  end if;

  if prefs ? 'pings' and pg_catalog.jsonb_typeof(prefs -> 'pings') = 'boolean' then
    pings_enabled := (prefs -> 'pings') = 'true'::jsonb;
  end if;

  quiet := prefs -> 'quiet';
  enabled := pg_catalog.jsonb_typeof(quiet) = 'object'
    and (quiet -> 'enabled') = 'true'::jsonb;
  if not enabled then
    return next;
    return;
  end if;

  start_text := quiet ->> 'start';
  end_text := quiet ->> 'end';
  if start_text !~ '^\d{2}:\d{2}$' or end_text !~ '^\d{2}:\d{2}$' then
    return next;
    return;
  end if;

  start_min := pg_catalog.substring(start_text, 1, 2)::integer * 60
    + pg_catalog.substring(start_text, 4, 2)::integer;
  end_min := pg_catalog.substring(end_text, 1, 2)::integer * 60
    + pg_catalog.substring(end_text, 4, 2)::integer;
  if start_min > 1439 or end_min > 1439
     or pg_catalog.substring(start_text, 4, 2)::integer > 59
     or pg_catalog.substring(end_text, 4, 2)::integer > 59
  then
    return next;
    return;
  end if;

  begin
    local_ts := pg_catalog.timezone(zone, moment);
  exception
    when others then
      local_ts := pg_catalog.timezone('UTC', moment);
  end;

  minutes := (extract(hour from local_ts))::integer * 60
    + (extract(minute from local_ts))::integer;

  if start_min = end_min then
    quiet_now := false;
  elsif start_min < end_min then
    quiet_now := minutes >= start_min and minutes < end_min;
  else
    quiet_now := minutes >= start_min or minutes < end_min;
  end if;

  in_quiet := quiet_now;
  if quiet_now then
    hour_part := end_min / 60;
    minute_part := end_min % 60;
    hour_12 := hour_part % 12;
    if hour_12 = 0 then
      hour_12 := 12;
    end if;
    resume_label := hour_12::text
      || case when minute_part = 0 then '' else ':' || pg_catalog.lpad(minute_part::text, 2, '0') end
      || case when hour_part < 12 then ' AM' else ' PM' end;
  end if;

  return next;
end;
$$;

revoke all on function public.recipient_quiet_status(uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.recipient_quiet_status(uuid, timestamptz) to authenticated;

comment on function public.recipient_quiet_status(uuid, timestamptz) is
  'Quiet-hours status at `at` (default now()) for yourself or someone you share an active circle with. An outsider and a former member get no row. The rest of notification_prefs stays hidden.';
