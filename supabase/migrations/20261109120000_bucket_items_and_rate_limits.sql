-- Week 5 bucket list and rate limits.
--
-- Additive on top of 20261102120000_pings.sql.
-- Safe to run once against a database that already has weeks 1–4.
-- Do not edit or re-run those files.
--
-- This adds public.bucket_items. Every active member of the circle can read
-- and edit every row. Someone who has left (left_at set) gets nothing.
-- circle_type is not read by these policies.
--
-- Marking an item done stamps completed_at. The Memory Wall row for that
-- completion is a later week; this column is the record that it happened.
--
-- The same file hardens limits that direct client calls cannot skip:
--   * a new invite row (create a circle, or make a new link) — 10 / 15 min
--   * redeem attempts — same 8 / 15 min and 20 / 15 min, now serialized
-- Pings stay at 10 / 10 min in the week 4 trigger. That trigger is not
-- replaced. Upstash, when configured, sits in front of these checks.

-- ---------------------------------------------------------------------------
-- bucket_items
-- ---------------------------------------------------------------------------

create table public.bucket_items (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- Null after the author's account is deleted ("Former member").
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  category text not null,
  status text not null default 'idea',
  -- Calendar date, no time and no zone. Null when nobody has picked one.
  planned_date date,
  -- Set by the trigger when status becomes done. Cleared if it moves back.
  completed_at timestamptz,
  notes text,
  link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bucket_items_category_known check (
    category in ('restaurant', 'movie', 'activity', 'date-idea', 'ldr-idea')
  ),
  constraint bucket_items_status_known check (
    status in ('idea', 'planned', 'done')
  ),
  constraint bucket_items_title_shape check (
    char_length(btrim(title)) between 1 and 120
  ),
  constraint bucket_items_notes_shape check (
    notes is null or char_length(notes) between 1 and 2000
  ),
  constraint bucket_items_link_shape check (
    link is null
    or (
      char_length(link) between 7 and 500
      and link ~* '^https?://[^[:space:]]+$'
    )
  ),
  constraint bucket_items_done_has_completed check (
    (status = 'done') = (completed_at is not null)
  )
);

comment on table public.bucket_items is
  'Shared list for one circle. Active members can read and write every row. A person who left cannot.';

comment on column public.bucket_items.category is
  'restaurant, movie, activity, date-idea, or ldr-idea (distance-specific).';

comment on column public.bucket_items.status is
  'idea, planned, or done.';

comment on column public.bucket_items.planned_date is
  'A calendar date (YYYY-MM-DD) with no time and no time zone.';

comment on column public.bucket_items.completed_at is
  'Stamped when status becomes done. The Memory Wall entry for that is a later week.';

comment on column public.bucket_items.created_by is
  'Who added it. Null means that account was deleted and the UI says Former member.';

create index bucket_items_circle_created_idx
  on public.bucket_items (circle_id, created_at desc);

alter table public.bucket_items enable row level security;

-- Realtime sends the old row on update and delete, including circle_id,
-- so a filtered subscription still matches those events.
alter table public.bucket_items replica identity full;

revoke all on table public.bucket_items from public, anon, authenticated;

grant select on table public.bucket_items to authenticated;

-- created_by, completed_at, and the timestamps are the trigger's.
-- A client cannot spoof the author or backdate a completion.
grant insert (
  circle_id,
  title,
  category,
  status,
  planned_date,
  notes,
  link
) on table public.bucket_items to authenticated;

grant update (
  title,
  category,
  status,
  planned_date,
  notes,
  link
) on table public.bucket_items to authenticated;

grant delete on table public.bucket_items to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy bucket_items_select_member
  on public.bucket_items
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy bucket_items_select_member on public.bucket_items is
  'Every active member of the circle. An outsider and a member who left get zero rows.';

create policy bucket_items_insert_member
  on public.bucket_items
  for insert
  to authenticated
  with check (
    private.is_active_member(circle_id)
    and created_by = (select auth.uid())
  );

comment on policy bucket_items_insert_member on public.bucket_items is
  'An active member adds a row as themselves. The trigger stamps created_by.';

create policy bucket_items_update_member
  on public.bucket_items
  for update
  to authenticated
  using (private.is_active_member(circle_id))
  with check (private.is_active_member(circle_id));

comment on policy bucket_items_update_member on public.bucket_items is
  'Any active member may edit any item in the circle, including one they did not add.';

create policy bucket_items_delete_member
  on public.bucket_items
  for delete
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy bucket_items_delete_member on public.bucket_items is
  'Any active member may remove an item.';

-- ---------------------------------------------------------------------------
-- Insert and update guard
-- ---------------------------------------------------------------------------

create function private.bucket_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := pg_catalog.btrim(new.title);

  if new.notes is not null and pg_catalog.btrim(new.notes) = '' then
    new.notes := null;
  end if;

  if new.link is not null and pg_catalog.btrim(new.link) = '' then
    new.link := null;
  elsif new.link is not null then
    new.link := pg_catalog.btrim(new.link);
  end if;

  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'hsummer_unauthenticated';
    end if;

    new.created_by := (select auth.uid());
    new.created_at := pg_catalog.now();
    new.updated_at := pg_catalog.now();

    if new.status = 'done' then
      new.completed_at := pg_catalog.now();
    else
      new.completed_at := null;
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
     or new.circle_id is distinct from old.circle_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'hsummer_bucket_locked';
  end if;

  new.updated_at := pg_catalog.now();

  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := pg_catalog.now();
  elsif new.status is distinct from 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;

  return new;
end;
$$;

revoke all on function private.bucket_items_guard()
  from public, anon, authenticated;

create trigger bucket_items_guard
  before insert or update on public.bucket_items
  for each row
  execute function private.bucket_items_guard();

comment on function private.bucket_items_guard() is
  'Stamps the author and completed_at, and refuses changes to the circle, the author, or created_at.';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Hosted Supabase already has the supabase_realtime publication. Adding the
-- table here is the same switch as the dashboard toggle. If that publication
-- does not exist yet, skip; enable Realtime for bucket_items in the dashboard
-- after this file has run.

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bucket_items'
  ) then
    alter publication supabase_realtime add table public.bucket_items;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Invite creation limit
-- ---------------------------------------------------------------------------
--
-- create_circle and regenerate_invite both insert a circle_invites row.
-- 10 new rows per person per 15 minutes. The new row is not counted until
-- the next call. created_at is stamped here so a caller cannot backdate it.
-- The advisory lock makes two overlapping calls share one count.

create index circle_invites_author_time_idx
  on public.circle_invites (created_by, created_at);

create function private.circle_invites_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  if new.created_by is null then
    new.created_at := pg_catalog.now();
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invite:' || new.created_by::text, 0)
  );

  select count(*)::integer
    into recent
  from public.circle_invites
  where created_by = new.created_by
    and created_at > pg_catalog.now() - interval '15 minutes';

  if recent >= 10 then
    raise exception 'hsummer_rate_limited';
  end if;

  new.created_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.circle_invites_guard_insert()
  from public, anon, authenticated;

create trigger circle_invites_guard_insert
  before insert on public.circle_invites
  for each row
  execute function private.circle_invites_guard_insert();

comment on function private.circle_invites_guard_insert() is
  'Allows 10 new invite rows per person per 15 minutes, including a new circle and a regenerated link.';

-- ---------------------------------------------------------------------------
-- Redeem attempts, serialized
-- ---------------------------------------------------------------------------
--
-- redeem_invite already inserts a row and then counts. This trigger takes
-- the locks before that insert is visible to the next transaction, so two
-- overlapping tries cannot both pass the 8 and 20 caps. The numbers stay
-- in redeem_invite. attempted_at is the database clock.

create function private.join_attempts_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('redeem-user:' || new.user_id::text, 0)
    );
  end if;

  if new.ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('redeem-ip:' || new.ip_hash, 0)
    );
  end if;

  new.attempted_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.join_attempts_guard_insert()
  from public, anon, authenticated;

create trigger join_attempts_guard_insert
  before insert on private.join_attempts
  for each row
  execute function private.join_attempts_guard_insert();

comment on function private.join_attempts_guard_insert() is
  'Serializes redeem attempts per user and per IP hash so the week 3 caps cannot be raced.';

comment on function public.redeem_invite(text, text) is
  'Joins a circle from an invite token. Rate-limited per user (8 / 15 min) and per IP hash (20 / 15 min). Overlapping tries share one count.';

comment on function private.pings_guard_insert() is
  'Rejects a whole-circle ping in a couple, stamps sent_at, and allows 10 pings per 10 minutes per sender. Direct inserts cannot skip this, including when Upstash is also configured.';
