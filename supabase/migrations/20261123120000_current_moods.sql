-- Week 7 current mood.
--
-- Additive on top of 20261116120000_backup_bucket.sql.
-- Safe to run once against a database that already has weeks 1–6.
-- Do not edit or re-run those files.
--
-- public.current_moods is one row per person per circle. Setting it does not
-- insert a ping and does not send a push. Sharing it is a separate pings row
-- (ping_type mood-share), written by the app through the same insert, rate
-- limit, and push path as Thinking of You.
--
-- Read: an active member, and only while the person who set the mood is
-- still an active member. Write: that person only. circle_type is not read.

-- ---------------------------------------------------------------------------
-- current_moods
-- ---------------------------------------------------------------------------

create table public.current_moods (
  user_id uuid not null references public.profiles (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  emoji text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, circle_id),
  constraint current_moods_emoji_known check (
    emoji in ('😊', '😌', '🥰', '😴', '😔', '✨')
  )
);

comment on table public.current_moods is
  'One current mood per person per circle. Active members can read it. Only that person can write it. Saving a mood does not send a push.';

comment on column public.current_moods.emoji is
  'One of the app moods: Good, Calm, Loved, Tired, Low, Excited.';

comment on column public.current_moods.updated_at is
  'Stamped by the trigger. A client cannot backdate it.';

create index current_moods_circle_idx
  on public.current_moods (circle_id);

alter table public.current_moods enable row level security;

-- Realtime sends the old row on update and delete, including circle_id,
-- so a filtered subscription still matches those events.
alter table public.current_moods replica identity full;

revoke all on table public.current_moods from public, anon, authenticated;

grant select on table public.current_moods to authenticated;

-- updated_at is the trigger's. user_id and circle_id are granted on update
-- because PostgREST upsert writes every column in the body on conflict.
-- The trigger rejects a change to either one.
grant insert (user_id, circle_id, emoji) on table public.current_moods to authenticated;

grant update (user_id, circle_id, emoji) on table public.current_moods to authenticated;

grant delete on table public.current_moods to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy current_moods_select_members
  on public.current_moods
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and private.is_active_member_user(circle_id, user_id)
  );

comment on policy current_moods_select_members on public.current_moods is
  'Active members can read moods of people who are still active members. An outsider, a person who left, and a departed person''s row all return nothing.';

create policy current_moods_insert_own
  on public.current_moods
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_active_member(circle_id)
  );

comment on policy current_moods_insert_own on public.current_moods is
  'You insert your own row, and only while you are an active member.';

create policy current_moods_update_own
  on public.current_moods
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_active_member(circle_id)
  )
  with check (
    user_id = (select auth.uid())
    and private.is_active_member(circle_id)
  );

comment on policy current_moods_update_own on public.current_moods is
  'You can change your own mood. You cannot change someone else''s, and you cannot move the row to another person.';

create policy current_moods_delete_own
  on public.current_moods
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_active_member(circle_id)
  );

comment on policy current_moods_delete_own on public.current_moods is
  'You can clear your own mood. Nobody else can.';

-- ---------------------------------------------------------------------------
-- Upsert guard
-- ---------------------------------------------------------------------------

create function private.current_moods_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is distinct from (select auth.uid()) then
      raise exception 'hsummer_mood_not_owner';
    end if;
    new.updated_at := pg_catalog.now();
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.circle_id is distinct from old.circle_id then
    raise exception 'hsummer_mood_locked';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.current_moods_guard()
  from public, anon, authenticated;

create trigger current_moods_guard
  before insert or update on public.current_moods
  for each row
  execute function private.current_moods_guard();

comment on function private.current_moods_guard() is
  'Stamps updated_at and refuses moving a mood onto another person or another circle.';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Hosted Supabase already has the supabase_realtime publication. Adding the
-- table here is the same switch as the dashboard toggle. If that publication
-- does not exist yet, skip; enable Realtime for current_moods in the dashboard
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
      and tablename = 'current_moods'
  ) then
    alter publication supabase_realtime add table public.current_moods;
  end if;
end
$$;
