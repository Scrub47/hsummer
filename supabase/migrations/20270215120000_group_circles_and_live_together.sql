-- Phase 4 (weeks 19–22): group circles and Live Together.
--
-- Additive on top of 20270125120000_launch_readiness.sql.
-- Safe to run once. Do not edit or re-run earlier files.
--
-- This adds:
--   * set_invite_max_uses — a group, family, or friends link can stay
--     unlimited or take a set number of joins. A couple link stays at 1.
--   * circle_push_windows — one row per person per circle, so a busy group
--     does not push every minute. Couples do not use this table.
--   * create_pass_booth_picked — a pass whose frames are split across the
--     people you chose. A couple keeps create_pass_booth.
--   * open_together_booth, mark_together_ready, submit_together_shots,
--     finish_together_booth, cancel_together_booth,
--     fallback_together_to_pass, expire_together_booths,
--     release_together_shots
--   * booth_clock_samples — the offset each phone estimated
--   * private channel policies so only that booth's people can join
--     the Realtime broadcast and presence topic
--
-- Supabase's SQL editor may flag CREATE OR REPLACE FUNCTION. The only
-- function replaced is private.memories_guard, appended at the bottom of
-- this file, so a finished Live Together strip can be saved the same way
-- a pass strip is. The replacement does not drop a table, column, policy,
-- or row.
--
-- Supabase may also flag one DELETE, inside release_together_shots. That
-- function runs only after a Live Together upload fails, and it deletes
-- only the caller's own booth_shots rows for that session. It does not
-- run when you apply this file. There is no DROP and no TRUNCATE.
-- Applying the file does not remove existing circles, letters, or photos.
--
-- circle_type is still not an access rule. It is read only to keep a
-- couple on the automatic partner path.

-- ---------------------------------------------------------------------------
-- Push windows (service role only)
-- ---------------------------------------------------------------------------

create table public.circle_push_windows (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_sent_at timestamptz,
  held_count integer not null default 0,
  primary key (circle_id, user_id),
  constraint circle_push_windows_held_nonnegative check (held_count >= 0)
);

comment on table public.circle_push_windows is
  'Group push batching. The first push in a minute is sent. Later ones in that minute are counted here. Not used for a couple. No client policy.';

alter table public.circle_push_windows enable row level security;

revoke all on table public.circle_push_windows from public, anon, authenticated;

grant select, insert, update, delete
  on table public.circle_push_windows to service_role;

-- ---------------------------------------------------------------------------
-- Clock samples
-- ---------------------------------------------------------------------------

create table public.booth_clock_samples (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.booth_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  offset_ms integer not null,
  rtt_ms integer not null,
  recorded_at timestamptz not null default now(),
  constraint booth_clock_samples_offset_range check (
    offset_ms between -120000 and 120000
  ),
  constraint booth_clock_samples_rtt_range check (
    rtt_ms between 0 and 30000
  )
);

comment on table public.booth_clock_samples is
  'Live Together clock estimates. A contributor can read samples for a session they are in. The ready function writes them.';

create index booth_clock_samples_session_idx
  on public.booth_clock_samples (session_id, recorded_at desc);

alter table public.booth_clock_samples enable row level security;

revoke all on table public.booth_clock_samples from public, anon, authenticated;

grant select on table public.booth_clock_samples to authenticated;

grant select, insert, update, delete
  on table public.booth_clock_samples to service_role;

create policy booth_clock_select_contributor
  on public.booth_clock_samples
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.booth_contributors as contributor
      join public.booth_sessions as session
        on session.id = contributor.session_id
      where contributor.session_id = booth_clock_samples.session_id
        and contributor.user_id = (select auth.uid())
        and private.is_active_member(session.circle_id)
    )
  );

comment on policy booth_clock_select_contributor
  on public.booth_clock_samples is
  'A person in the booth can read the offsets for that session. A circle member who was not picked, and an outsider, get nothing.';

comment on column public.booth_contributors.ready_at is
  'Set when this person taps ready in Live Together. Null on a pass and on a solo strip.';

alter table public.booth_sessions replica identity full;
alter table public.booth_contributors replica identity full;

-- ---------------------------------------------------------------------------
-- Frame split. The starter is index 0 and receives any extra frame.
-- ---------------------------------------------------------------------------

create function private.booth_position_plan(target_layout text, people integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  slots integer;
  base_count integer;
  extra integer;
  cursor_pos integer := 0;
  person integer;
  take integer;
  step integer;
  slice integer[];
  plan jsonb := '[]'::jsonb;
begin
  if target_layout = '4-cut' then
    slots := 4;
  elsif target_layout = '2-cut' then
    slots := 2;
  else
    raise exception 'hsummer_booth_memory';
  end if;

  if people < 2 or people > slots then
    raise exception 'hsummer_booth_memory';
  end if;

  base_count := slots / people;
  extra := slots % people;

  for person in 1..people loop
    take := base_count + case when person <= extra then 1 else 0 end;
    slice := '{}'::integer[];
    for step in 1..take loop
      slice := slice || cursor_pos;
      cursor_pos := cursor_pos + 1;
    end loop;
    plan := plan || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(slice));
  end loop;

  return plan;
end;
$$;

revoke all on function private.booth_position_plan(text, integer)
  from public, anon, authenticated;

comment on function private.booth_position_plan(text, integer) is
  'Splits strip positions across people. Index 0 is the starter. The sets cover every position once.';

create function private.booth_participant_order(actor uuid, raw_ids uuid[])
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  ordered uuid[] := array[actor];
  person uuid;
begin
  if actor is null or raw_ids is null or not (actor = any (raw_ids)) then
    raise exception 'hsummer_booth_memory';
  end if;

  foreach person in array raw_ids loop
    if person is null then
      raise exception 'hsummer_booth_memory';
    end if;
    if person <> actor and not (person = any (ordered)) then
      ordered := ordered || person;
    end if;
  end loop;

  return ordered;
end;
$$;

revoke all on function private.booth_participant_order(uuid, uuid[])
  from public, anon, authenticated;

create function private.booth_positions_at(plan jsonb, person_index integer)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(
      select item::integer
      from pg_catalog.jsonb_array_elements_text(plan -> person_index) as item
    ),
    '{}'::integer[]
  );
$$;

revoke all on function private.booth_positions_at(jsonb, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Group invite cap
-- ---------------------------------------------------------------------------

create function public.set_invite_max_uses(target_circle uuid, next_max integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  kind text;
  live_id uuid;
  used integer;
begin
  perform private.assert_real_account(actor);
  if not private.is_active_member(target_circle) then
    raise exception 'hsummer_not_member';
  end if;

  select circle.circle_type
    into kind
  from public.circles as circle
  where circle.id = target_circle;

  if kind = 'couple' then
    raise exception 'hsummer_couple_invite';
  end if;
  if kind is null or kind not in ('group', 'family', 'friends') then
    raise exception 'hsummer_bad_type';
  end if;
  if next_max is not null and (next_max < 1 or next_max > 100) then
    raise exception 'hsummer_invite_cap';
  end if;

  select invite.id, invite.use_count
    into live_id, used
  from public.circle_invites as invite
  where invite.circle_id = target_circle
    and invite.revoked_at is null
  for update;

  if live_id is null then
    raise exception 'hsummer_not_member';
  end if;
  if next_max is not null and next_max < used then
    raise exception 'hsummer_invite_cap';
  end if;

  update public.circle_invites
    set max_uses = next_max
  where id = live_id;
end;
$$;

revoke all on function public.set_invite_max_uses(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.set_invite_max_uses(uuid, integer)
  to authenticated;

comment on function public.set_invite_max_uses(uuid, integer) is
  'Sets how many times the live group link can be used. Null means until it expires. A couple link cannot be changed. The demo account cannot call it.';

-- ---------------------------------------------------------------------------
-- Pass with chosen people
-- ---------------------------------------------------------------------------

create function public.create_pass_booth_picked(
  target_circle uuid,
  participant_ids uuid[],
  target_theme text,
  target_layout text,
  target_filter text,
  target_caption text,
  shot_sizes integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  kind text;
  ordered uuid[];
  plan jsonb;
  mine integer[];
  person_index integer;
  person uuid;
  shot_index integer;
  new_session uuid;
  paths text[] := '{}'::text[];
  caption text;
  recent integer;
  open_count integer;
begin
  actor := (select auth.uid());
  if actor is null or not private.is_active_member(target_circle) then
    raise exception 'hsummer_booth_memory';
  end if;

  select circle.circle_type
    into kind
  from public.circles as circle
  where circle.id = target_circle;

  if kind = 'couple' then
    raise exception 'hsummer_booth_couple';
  end if;

  if target_theme not in ('kawaii', 'minimal')
     or target_filter not in ('none', 'bw', 'sepia', 'warm', 'cool', 'grain')
  then
    raise exception 'hsummer_booth_memory';
  end if;

  ordered := private.booth_participant_order(actor, participant_ids);
  plan := private.booth_position_plan(target_layout, pg_catalog.cardinality(ordered));
  mine := private.booth_positions_at(plan, 0);

  if exists (
    select 1
    from pg_catalog.unnest(ordered) as person_id
    where not private.is_active_member_user(target_circle, person_id)
  ) then
    raise exception 'hsummer_booth_memory';
  end if;

  if shot_sizes is null
     or pg_catalog.cardinality(shot_sizes) is distinct from pg_catalog.cardinality(mine)
  then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-rate:' || actor::text, 0)
  );

  select count(*)::integer
    into recent
  from public.booth_sessions
  where created_by = actor
    and mode = 'pass'
    and created_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 10 then
    raise exception 'hsummer_rate_limited';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-open:' || target_circle::text, 0)
  );

  select count(*)::integer
    into open_count
  from public.booth_sessions
  where circle_id = target_circle
    and mode = 'pass'
    and status = 'open';

  if open_count >= 3 then
    raise exception 'hsummer_booth_open';
  end if;

  caption := nullif(pg_catalog.btrim(coalesce(target_caption, '')), '');
  if caption is not null and pg_catalog.char_length(caption) > 280 then
    raise exception 'hsummer_booth_memory';
  end if;

  new_session := gen_random_uuid();

  for shot_index in 1..pg_catalog.cardinality(mine) loop
    if shot_sizes[shot_index] is null
       or shot_sizes[shot_index] < 1
       or shot_sizes[shot_index] > 2097152
    then
      raise exception 'hsummer_booth_memory';
    end if;
    paths := paths || (
      target_circle::text
      || '/'
      || new_session::text
      || '/'
      || mine[shot_index]::text
      || '.jpg'
    );
  end loop;

  insert into public.booth_sessions (
    id, circle_id, created_by, mode, theme, frame_layout, status, expires_at, caption
  ) values (
    new_session,
    target_circle,
    actor,
    'pass',
    target_theme,
    target_layout,
    'open',
    pg_catalog.now() + interval '7 days',
    caption
  );

  person_index := 0;
  foreach person in array ordered loop
    insert into public.booth_contributors (
      session_id, user_id, assigned_positions, filter_id
    ) values (
      new_session,
      person,
      private.booth_positions_at(plan, person_index),
      case when person = actor then target_filter else 'none' end
    );
    person_index := person_index + 1;
  end loop;

  for shot_index in 1..pg_catalog.cardinality(mine) loop
    insert into public.booth_shots (
      session_id, user_id, position, storage_path, byte_size
    ) values (
      new_session,
      actor,
      mine[shot_index],
      paths[shot_index],
      shot_sizes[shot_index]
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'session_id', new_session,
    'positions', pg_catalog.to_jsonb(mine),
    'paths', pg_catalog.to_jsonb(paths)
  );
end;
$$;

revoke all on function public.create_pass_booth_picked(uuid, uuid[], text, text, text, text, integer[])
  from public, anon, authenticated;

grant execute on function public.create_pass_booth_picked(uuid, uuid[], text, text, text, text, integer[])
  to authenticated;

comment on function public.create_pass_booth_picked(uuid, uuid[], text, text, text, text, integer[]) is
  'Starts a pass for the caller and the other active members they named. A couple cannot call it. Positions cover the strip once. The caller uploads their frames now.';

-- ---------------------------------------------------------------------------
-- Live Together lobby
-- ---------------------------------------------------------------------------

create function public.open_together_booth(
  target_circle uuid,
  participant_ids uuid[],
  target_theme text,
  target_layout text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  kind text;
  active_count integer;
  ordered uuid[];
  plan jsonb;
  mine integer[];
  person_index integer;
  person uuid;
  new_session uuid;
  open_count integer;
  recent integer;
  expires_at timestamptz;
begin
  actor := (select auth.uid());
  if actor is null or not private.is_active_member(target_circle) then
    raise exception 'hsummer_booth_memory';
  end if;

  if target_theme not in ('kawaii', 'minimal') then
    raise exception 'hsummer_booth_memory';
  end if;

  select circle.circle_type
    into kind
  from public.circles as circle
  where circle.id = target_circle;

  select count(*)::integer
    into active_count
  from public.circle_members as member
  where member.circle_id = target_circle
    and member.left_at is null;

  ordered := private.booth_participant_order(actor, participant_ids);

  if exists (
    select 1
    from pg_catalog.unnest(ordered) as person_id
    where not private.is_active_member_user(target_circle, person_id)
  ) then
    raise exception 'hsummer_booth_memory';
  end if;

  if kind = 'couple' or active_count = 2 then
    if pg_catalog.cardinality(ordered) is distinct from active_count
       or exists (
         select 1
         from public.circle_members as member
         where member.circle_id = target_circle
           and member.left_at is null
           and not (member.user_id = any (ordered))
       )
    then
      raise exception 'hsummer_booth_pair';
    end if;
  end if;

  plan := private.booth_position_plan(
    target_layout,
    pg_catalog.cardinality(ordered)
  );
  mine := private.booth_positions_at(plan, 0);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-together-rate:' || actor::text, 0)
  );

  select count(*)::integer
    into recent
  from public.booth_sessions
  where created_by = actor
    and mode = 'together'
    and created_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 10 then
    raise exception 'hsummer_rate_limited';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-together-open:' || target_circle::text, 0)
  );

  select count(*)::integer
    into open_count
  from public.booth_sessions
  where circle_id = target_circle
    and mode = 'together'
    and status in ('open', 'ready', 'capturing');

  if open_count >= 1 then
    raise exception 'hsummer_together_open';
  end if;

  new_session := gen_random_uuid();
  expires_at := pg_catalog.now() + interval '10 minutes';

  insert into public.booth_sessions (
    id, circle_id, created_by, mode, theme, frame_layout, status, expires_at
  ) values (
    new_session,
    target_circle,
    actor,
    'together',
    target_theme,
    target_layout,
    'open',
    expires_at
  );

  person_index := 0;
  foreach person in array ordered loop
    insert into public.booth_contributors (
      session_id, user_id, assigned_positions, filter_id
    ) values (
      new_session,
      person,
      private.booth_positions_at(plan, person_index),
      'none'
    );
    person_index := person_index + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'session_id', new_session,
    'positions', pg_catalog.to_jsonb(mine),
    'expires_at', expires_at
  );
end;
$$;

revoke all on function public.open_together_booth(uuid, uuid[], text, text)
  from public, anon, authenticated;

grant execute on function public.open_together_booth(uuid, uuid[], text, text)
  to authenticated;

comment on function public.open_together_booth(uuid, uuid[], text, text) is
  'Opens a Live Together lobby. A couple, and any circle of two, must include both people. A larger circle can pick a subset. The lobby closes after 10 minutes. No photos yet.';

create function private.together_lobby(target_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  session_status text;
  session_capture timestamptz;
  session_expires timestamptz;
  ready_ids uuid[];
  waiting_ids uuid[];
begin
  select session.status, session.capture_at, session.expires_at
    into session_status, session_capture, session_expires
  from public.booth_sessions as session
  where session.id = target_session;

  select coalesce(array_agg(contributor.user_id order by contributor.user_id), '{}'::uuid[])
    into ready_ids
  from public.booth_contributors as contributor
  where contributor.session_id = target_session
    and contributor.ready_at is not null;

  select coalesce(array_agg(contributor.user_id order by contributor.user_id), '{}'::uuid[])
    into waiting_ids
  from public.booth_contributors as contributor
  where contributor.session_id = target_session
    and contributor.ready_at is null;

  return pg_catalog.jsonb_build_object(
    'status', session_status,
    'capture_at', session_capture,
    'expires_at', session_expires,
    'ready_ids', pg_catalog.to_jsonb(ready_ids),
    'waiting_ids', pg_catalog.to_jsonb(waiting_ids)
  );
end;
$$;

revoke all on function private.together_lobby(uuid)
  from public, anon, authenticated;

create function public.mark_together_ready(
  target_session uuid,
  offset_ms integer default null,
  rtt_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_expires timestamptz;
  session_capture timestamptz;
  session_circle uuid;
  still_waiting integer;
begin
  actor := (select auth.uid());
  if actor is null then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-session:' || target_session::text, 0)
  );

  select
    session.mode,
    session.status,
    session.expires_at,
    session.capture_at,
    session.circle_id
    into
      session_mode,
      session_status,
      session_expires,
      session_capture,
      session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or not private.is_active_member(session_circle)
     or not exists (
       select 1
       from public.booth_contributors as contributor
       where contributor.session_id = target_session
         and contributor.user_id = actor
     )
  then
    raise exception 'hsummer_booth_memory';
  end if;

  if session_status = 'open'
     and session_capture is null
     and session_expires is not null
     and session_expires <= pg_catalog.now()
  then
    update public.booth_sessions
      set status = 'expired'
    where id = target_session
      and status = 'open';
    perform private.close_pass_shots(target_session);
    return private.together_lobby(target_session);
  end if;

  if session_status in ('cancelled', 'expired', 'complete') then
    return private.together_lobby(target_session);
  end if;

  update public.booth_contributors
    set ready_at = pg_catalog.now()
  where session_id = target_session
    and user_id = actor
    and ready_at is null;

  if offset_ms is not null
     and rtt_ms is not null
     and offset_ms between -120000 and 120000
     and rtt_ms between 0 and 30000
  then
    insert into public.booth_clock_samples (session_id, user_id, offset_ms, rtt_ms)
    values (target_session, actor, offset_ms, rtt_ms);
  end if;

  select count(*)::integer
    into still_waiting
  from public.booth_contributors as contributor
  where contributor.session_id = target_session
    and contributor.ready_at is null;

  if still_waiting = 0
     and session_status = 'open'
     and session_capture is null
  then
    update public.booth_sessions
      set
        status = 'ready',
        capture_at = pg_catalog.now() + interval '5 seconds',
        expires_at = pg_catalog.now() + interval '5 seconds' + interval '2 minutes'
    where id = target_session
      and status = 'open'
      and capture_at is null;
  end if;

  return private.together_lobby(target_session);
end;
$$;

revoke all on function public.mark_together_ready(uuid, integer, integer)
  from public, anon, authenticated;

grant execute on function public.mark_together_ready(uuid, integer, integer)
  to authenticated;

comment on function public.mark_together_ready(uuid, integer, integer) is
  'Marks the caller ready. When every chosen person is ready, sets one capture_at five seconds ahead and stores the caller''s clock offset. A person who was not picked cannot call it.';

create function public.submit_together_shots(
  target_session uuid,
  target_filter text,
  shot_sizes integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_expires timestamptz;
  session_capture timestamptz;
  session_circle uuid;
  mine integer[];
  existing integer;
  shot_index integer;
  paths text[] := '{}'::text[];
begin
  actor := (select auth.uid());
  if actor is null
     or target_filter not in ('none', 'bw', 'sepia', 'warm', 'cool', 'grain')
  then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-session:' || target_session::text, 0)
  );

  select
    session.mode,
    session.status,
    session.expires_at,
    session.capture_at,
    session.circle_id
    into
      session_mode,
      session_status,
      session_expires,
      session_capture,
      session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or not private.is_active_member(session_circle)
     or not exists (
       select 1
       from public.booth_contributors as contributor
       where contributor.session_id = target_session
         and contributor.user_id = actor
     )
  then
    raise exception 'hsummer_booth_memory';
  end if;

  if session_status in ('cancelled', 'expired', 'complete') then
    return pg_catalog.jsonb_build_object(
      'status', session_status,
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  if session_expires is not null and session_expires <= pg_catalog.now() then
    update public.booth_sessions
      set status = 'expired'
    where id = target_session
      and status in ('open', 'ready', 'capturing');
    perform private.close_pass_shots(target_session);
    return pg_catalog.jsonb_build_object(
      'status', 'expired',
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  if session_capture is null or session_capture > pg_catalog.now() then
    raise exception 'hsummer_booth_early';
  end if;

  if session_status = 'ready' then
    update public.booth_sessions
      set status = 'capturing'
    where id = target_session
      and status = 'ready';
    session_status := 'capturing';
  end if;

  if session_status is distinct from 'capturing' then
    return pg_catalog.jsonb_build_object(
      'status', session_status,
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  select coalesce(array_agg(pos order by pos), '{}'::integer[])
    into mine
  from public.booth_contributors as contributor
  cross join lateral pg_catalog.unnest(contributor.assigned_positions) as assigned(pos)
  where contributor.session_id = target_session
    and contributor.user_id = actor;

  select count(*)::integer
    into existing
  from public.booth_shots
  where session_id = target_session
    and user_id = actor;

  if existing = pg_catalog.cardinality(mine) and existing > 0 then
    select coalesce(array_agg(shot.storage_path order by shot.position), '{}'::text[])
      into paths
    from public.booth_shots as shot
    where shot.session_id = target_session
      and shot.user_id = actor;
    return pg_catalog.jsonb_build_object(
      'status', 'capturing',
      'paths', pg_catalog.to_jsonb(paths),
      'already', true
    );
  end if;

  if existing <> 0
     or shot_sizes is null
     or pg_catalog.cardinality(shot_sizes) is distinct from pg_catalog.cardinality(mine)
  then
    raise exception 'hsummer_booth_memory';
  end if;

  for shot_index in 1..pg_catalog.cardinality(mine) loop
    if shot_sizes[shot_index] is null
       or shot_sizes[shot_index] < 1
       or shot_sizes[shot_index] > 2097152
    then
      raise exception 'hsummer_booth_memory';
    end if;
    paths := paths || (
      session_circle::text
      || '/'
      || target_session::text
      || '/'
      || mine[shot_index]::text
      || '.jpg'
    );
  end loop;

  update public.booth_contributors
    set filter_id = target_filter
  where session_id = target_session
    and user_id = actor;

  for shot_index in 1..pg_catalog.cardinality(mine) loop
    insert into public.booth_shots (
      session_id, user_id, position, storage_path, byte_size
    ) values (
      target_session,
      actor,
      mine[shot_index],
      paths[shot_index],
      shot_sizes[shot_index]
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'capturing',
    'paths', pg_catalog.to_jsonb(paths),
    'already', false
  );
end;
$$;

revoke all on function public.submit_together_shots(uuid, text, integer[])
  from public, anon, authenticated;

grant execute on function public.submit_together_shots(uuid, text, integer[])
  to authenticated;

comment on function public.submit_together_shots(uuid, text, integer[]) is
  'Records the caller''s frames after the shared shutter. Refuses a shot before capture_at. A non-contributor gets nothing.';

create function public.finish_together_booth(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_expires timestamptz;
  session_circle uuid;
  session_layout text;
  expected integer;
  shot_count integer;
  total integer;
  new_memory uuid;
begin
  actor := (select auth.uid());
  if actor is null then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-session:' || target_session::text, 0)
  );

  select
    session.mode,
    session.status,
    session.expires_at,
    session.circle_id,
    session.frame_layout
    into
      session_mode,
      session_status,
      session_expires,
      session_circle,
      session_layout
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or not private.is_active_member(session_circle)
     or not exists (
       select 1
       from public.booth_contributors as contributor
       where contributor.session_id = target_session
         and contributor.user_id = actor
     )
  then
    raise exception 'hsummer_booth_memory';
  end if;

  if session_status = 'complete' then
    select memory.id
      into new_memory
    from public.memories as memory
    where memory.booth_session_id = target_session;
    return pg_catalog.jsonb_build_object(
      'status', 'complete',
      'memory_id', new_memory
    );
  end if;

  if session_status in ('cancelled', 'expired') then
    return pg_catalog.jsonb_build_object(
      'status', session_status,
      'memory_id', null
    );
  end if;

  if session_expires is not null and session_expires <= pg_catalog.now() then
    update public.booth_sessions
      set status = 'expired'
    where id = target_session
      and status in ('open', 'ready', 'capturing');
    perform private.close_pass_shots(target_session);
    return pg_catalog.jsonb_build_object(
      'status', 'expired',
      'memory_id', null
    );
  end if;

  if session_layout = '4-cut' then
    expected := 4;
  elsif session_layout = '2-cut' then
    expected := 2;
  else
    raise exception 'hsummer_booth_memory';
  end if;

  select count(*)::integer, coalesce(sum(shot.byte_size), 0)::integer
    into shot_count, total
  from public.booth_shots as shot
  where shot.session_id = target_session;

  if shot_count < expected or session_status not in ('ready', 'capturing') then
    return private.together_lobby(target_session) || pg_catalog.jsonb_build_object(
      'memory_id', null
    );
  end if;

  update public.booth_sessions
    set status = 'complete'
  where id = target_session
    and status in ('ready', 'capturing');

  perform pg_catalog.set_config('hsummer.booth_save', '1', true);

  insert into public.memories (
    circle_id,
    created_by,
    kind,
    body,
    photo_path,
    photo_bytes,
    tags,
    visibility,
    occurred_on,
    booth_session_id
  ) values (
    session_circle,
    actor,
    'photo-strip',
    null,
    null,
    total,
    array['photo-booth']::text[],
    'circle',
    private.viewer_local_date(actor),
    target_session
  )
  returning id into new_memory;

  return pg_catalog.jsonb_build_object(
    'status', 'complete',
    'memory_id', new_memory
  );
end;
$$;

revoke all on function public.finish_together_booth(uuid)
  from public, anon, authenticated;

grant execute on function public.finish_together_booth(uuid)
  to authenticated;

comment on function public.finish_together_booth(uuid) is
  'When every Live Together frame is in, marks the session complete and inserts one circle-visible photo-strip memory. Safe to call again.';

create function public.cancel_together_booth(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_owner uuid;
  session_circle uuid;
begin
  actor := (select auth.uid());
  if actor is null then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-session:' || target_session::text, 0)
  );

  select session.mode, session.status, session.created_by, session.circle_id
    into session_mode, session_status, session_owner, session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or session_owner is distinct from actor
     or not private.is_active_member(session_circle)
     or session_status not in ('open', 'ready', 'capturing')
  then
    raise exception 'hsummer_booth_memory';
  end if;

  update public.booth_sessions
    set status = 'cancelled'
  where id = target_session;

  perform private.close_pass_shots(target_session);

  return pg_catalog.jsonb_build_object('status', 'cancelled');
end;
$$;

revoke all on function public.cancel_together_booth(uuid)
  from public, anon, authenticated;

grant execute on function public.cancel_together_booth(uuid)
  to authenticated;

comment on function public.cancel_together_booth(uuid) is
  'The person who opened the lobby can cancel it before the strip is saved. Anyone else cannot.';

create function public.fallback_together_to_pass(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_owner uuid;
  session_capture timestamptz;
  session_circle uuid;
begin
  actor := (select auth.uid());
  if actor is null then
    raise exception 'hsummer_booth_memory';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-pass-session:' || target_session::text, 0)
  );

  select
    session.mode,
    session.status,
    session.created_by,
    session.capture_at,
    session.circle_id
    into
      session_mode,
      session_status,
      session_owner,
      session_capture,
      session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or session_owner is distinct from actor
     or not private.is_active_member(session_circle)
     or session_status is distinct from 'open'
     or session_capture is not null
  then
    raise exception 'hsummer_booth_memory';
  end if;

  update public.booth_sessions
    set
      mode = 'pass',
      expires_at = pg_catalog.now() + interval '7 days'
  where id = target_session;

  update public.booth_contributors
    set ready_at = null
  where session_id = target_session;

  return pg_catalog.jsonb_build_object('status', 'pass');
end;
$$;

revoke all on function public.fallback_together_to_pass(uuid)
  from public, anon, authenticated;

grant execute on function public.fallback_together_to_pass(uuid)
  to authenticated;

comment on function public.fallback_together_to_pass(uuid) is
  'Turns an open lobby that has not started its countdown into a pass. The same people keep their frames. The shutter is not shared anymore.';

create function public.expire_together_booths(target_circle uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid;
  closed_count integer := 0;
begin
  if actor is not null then
    if target_circle is null or not private.is_active_member(target_circle) then
      raise exception 'hsummer_booth_memory';
    end if;
  end if;

  for target in
    select session.id
    from public.booth_sessions as session
    where session.mode = 'together'
      and session.status in ('open', 'ready', 'capturing')
      and session.expires_at is not null
      and session.expires_at <= pg_catalog.now()
      and (target_circle is null or session.circle_id = target_circle)
      and (
        actor is not null
        or not private.circle_is_demo(session.circle_id)
      )
    for update
  loop
    update public.booth_sessions
      set status = 'expired'
    where id = target
      and status in ('open', 'ready', 'capturing');
    perform private.close_pass_shots(target);
    closed_count := closed_count + 1;
  end loop;

  return closed_count;
end;
$$;

revoke all on function public.expire_together_booths(uuid)
  from public, anon, authenticated;

grant execute on function public.expire_together_booths(uuid)
  to authenticated, service_role;

comment on function public.expire_together_booths(uuid) is
  'Closes Live Together lobbies whose time is up, including a no-show. A signed-in person can expire only a circle they still belong to. The daily job, with no user, expires the rest except the demo.';

-- ---------------------------------------------------------------------------
-- Realtime: only the people in this lobby
-- ---------------------------------------------------------------------------

create function private.can_join_together_topic(topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    topic ~ '^together:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.booth_contributors as contributor
      join public.booth_sessions as session
        on session.id = contributor.session_id
      where contributor.session_id = substring(topic from 10)::uuid
        and contributor.user_id = (select auth.uid())
        and session.mode in ('together', 'pass')
        and session.status in ('open', 'ready', 'capturing')
        and private.is_active_member(session.circle_id)
    );
$$;

revoke all on function private.can_join_together_topic(text)
  from public, anon, authenticated;

comment on function private.can_join_together_topic(text) is
  'True when the signed-in person is a contributor of the Live Together session named by the Realtime topic. Not granted to clients.';

do $realtime$
begin
  if to_regnamespace('realtime') is null
     or to_regprocedure('realtime.topic()') is null
  then
    raise notice 'realtime.topic() is missing; together channel policies were skipped';
    return;
  end if;

  execute 'alter table realtime.messages enable row level security';

  execute $policy$
    create policy together_channel_read
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension in ('broadcast', 'presence')
      and private.can_join_together_topic(realtime.topic())
    )
  $policy$;

  execute $policy$
    create policy together_channel_write
    on realtime.messages
    for insert
    to authenticated
    with check (
      realtime.messages.extension in ('broadcast', 'presence')
      and private.can_join_together_topic(realtime.topic())
    )
  $policy$;
end
$realtime$;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booth_sessions'
  ) then
    alter publication supabase_realtime add table public.booth_sessions;
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booth_contributors'
  ) then
    alter publication supabase_realtime add table public.booth_contributors;
  end if;
end $$;

-- Removes the caller's frames when a Live Together upload fails. The other
-- people's frames stay. This is a new function. It does not replace
-- release_pass_shots, which only accepts a pass.

create function public.release_together_shots(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  session_mode text;
  session_status text;
  session_circle uuid;
begin
  actor := (select auth.uid());
  if actor is null then
    raise exception 'hsummer_booth_memory';
  end if;

  select session.mode, session.status, session.circle_id
    into session_mode, session_status, session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'together'
     or session_status is distinct from 'capturing'
     or not private.is_active_member(session_circle)
     or not exists (
       select 1
       from public.booth_contributors as contributor
       where contributor.session_id = target_session
         and contributor.user_id = actor
     )
  then
    raise exception 'hsummer_booth_memory';
  end if;

  delete from public.booth_shots
  where session_id = target_session
    and user_id = actor;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.release_together_shots(uuid)
  from public, anon, authenticated;

grant execute on function public.release_together_shots(uuid)
  to authenticated;

comment on function public.release_together_shots(uuid) is
  'Removes the caller''s frames from a capturing Live Together session when their upload failed. Other people''s frames stay. The DELETE is the same shape as release_pass_shots, limited to the caller''s rows.';

-- ---------------------------------------------------------------------------
-- Allow a Live Together strip onto the wall.
-- CREATE OR REPLACE replaces the function body. It does not delete rows.
-- Supabase may flag the replacement. The only change is that mode
-- 'together' is saved like mode 'pass'.
-- ---------------------------------------------------------------------------

create or replace function private.memories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
  used integer;
  actor uuid;
  letter_circle uuid;
  letter_from uuid;
  letter_to uuid;
  letter_status text;
  letter_delivered timestamptz;
  checkpoint_circle uuid;
  checkpoint_hit timestamptz;
  session_circle uuid;
  session_owner uuid;
  session_mode text;
  shot_bytes integer;
  session_status text;
  session_layout text;
  shot_count integer;
  expected_shots integer;
begin
  actor := (select auth.uid());

  if new.body is not null then
    new.body := pg_catalog.btrim(new.body);
    if new.body = '' then
      new.body := null;
    end if;
  end if;

  new.tags := coalesce(
    (
      select pg_catalog.array_agg(distinct tag order by tag)
      from (
        select pg_catalog.lower(pg_catalog.btrim(tag)) as tag
        from pg_catalog.unnest(coalesce(new.tags, '{}'::text[])) as tag
      ) cleaned
      where tag <> ''
    ),
    '{}'::text[]
  );

  if new.kind = 'letter' then
    if pg_catalog.current_setting('hsummer.letter_open', true) is distinct from '1' then
      raise exception 'hsummer_letter_memory';
    end if;

    select
      letter.circle_id,
      letter.from_user_id,
      letter.to_user_id,
      letter.status,
      letter.delivered_at
      into letter_circle, letter_from, letter_to, letter_status, letter_delivered
    from public.letters as letter
    where letter.id = new.letter_id;

    if not found
       or letter_circle is distinct from new.circle_id
       or letter_status is distinct from 'delivered'
       or letter_delivered is null
       or new.created_by is distinct from letter_from
       or actor is distinct from letter_to
    then
      raise exception 'hsummer_letter_memory';
    end if;

    if tg_op = 'INSERT' then
      new.photo_path := null;
      new.photo_bytes := 0;
      new.visibility := 'selected';
      new.checkpoint_id := null;
      new.booth_session_id := null;
    end if;
  elsif new.kind = 'milestone' then
    if pg_catalog.current_setting('hsummer.checkpoint_hit', true) is distinct from '1' then
      raise exception 'hsummer_checkpoint_memory';
    end if;

    select checkpoint.circle_id, checkpoint.hit_at
      into checkpoint_circle, checkpoint_hit
    from public.checkpoints as checkpoint
    where checkpoint.id = new.checkpoint_id;

    if not found
       or checkpoint_circle is distinct from new.circle_id
       or checkpoint_hit is null
       or actor is null
       or new.created_by is distinct from actor
       or not private.is_active_member(new.circle_id)
    then
      raise exception 'hsummer_checkpoint_memory';
    end if;

    if tg_op = 'INSERT' then
      new.photo_path := null;
      new.photo_bytes := 0;
      new.visibility := 'circle';
      new.letter_id := null;
      new.booth_session_id := null;
    end if;
  elsif new.kind = 'photo-strip' then
    if pg_catalog.current_setting('hsummer.booth_save', true) is distinct from '1' then
      raise exception 'hsummer_booth_memory';
    end if;

    if new.booth_session_id is null
       or new.letter_id is not null
       or new.checkpoint_id is not null
       or new.photo_path is not null
       or new.visibility is distinct from 'circle'
       or new.photo_bytes < 1
       or new.photo_bytes > 8388608
    then
      raise exception 'hsummer_booth_memory';
    end if;

    select
      session.circle_id,
      session.created_by,
      session.mode,
      session.status,
      session.frame_layout
      into session_circle, session_owner, session_mode, session_status, session_layout
    from public.booth_sessions as session
    where session.id = new.booth_session_id;

    if not found
       or session_circle is distinct from new.circle_id
       or actor is null
       or session_status is distinct from 'complete'
    then
      raise exception 'hsummer_booth_memory';
    end if;

    if session_mode = 'solo' then
      if session_owner is distinct from new.created_by
         or actor is distinct from new.created_by
      then
        raise exception 'hsummer_booth_memory';
      end if;
    elsif session_mode in ('pass', 'together') then
      if actor is distinct from new.created_by
         or not exists (
           select 1
           from public.booth_contributors as contributor
           where contributor.session_id = new.booth_session_id
             and contributor.user_id = actor
         )
      then
        raise exception 'hsummer_booth_memory';
      end if;
    else
      raise exception 'hsummer_booth_memory';
    end if;

    if session_layout = '4-cut' then
      expected_shots := 4;
    elsif session_layout = '2-cut' then
      expected_shots := 2;
    else
      raise exception 'hsummer_booth_memory';
    end if;

    select coalesce(sum(shot.byte_size), 0)::integer, count(*)::integer
      into shot_bytes, shot_count
    from public.booth_shots as shot
    where shot.session_id = new.booth_session_id;

    if shot_bytes is distinct from new.photo_bytes
       or shot_count is distinct from expected_shots
       or exists (
         select 1
         from public.booth_shots as shot
         where shot.session_id = new.booth_session_id
           and (shot.position < 0 or shot.position >= expected_shots)
       )
    then
      raise exception 'hsummer_booth_memory';
    end if;

    if tg_op = 'INSERT' then
      new.photo_path := null;
      new.visibility := 'circle';
      new.letter_id := null;
      new.checkpoint_id := null;
    end if;
  elsif new.kind = 'note' then
    if new.letter_id is not null
       or new.checkpoint_id is not null
       or new.booth_session_id is not null
    then
      raise exception 'hsummer_letter_memory';
    end if;
    new.photo_path := null;
    new.photo_bytes := 0;
  elsif new.kind = 'photo' then
    if new.letter_id is not null
       or new.checkpoint_id is not null
       or new.booth_session_id is not null
    then
      raise exception 'hsummer_letter_memory';
    end if;
    if new.photo_path is null
       or new.photo_path <> (
         new.circle_id::text
         || '/'
         || new.id::text
         || case
           when new.photo_path ~ '\.jpg$' then '.jpg'
           when new.photo_path ~ '\.png$' then '.png'
           when new.photo_path ~ '\.webp$' then '.webp'
           else ''
         end
       )
    then
      raise exception 'hsummer_memory_path';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'letter' or new.kind = 'milestone' then
      new.created_at := pg_catalog.now();
    elsif actor is null then
      if new.created_by is null then
        raise exception 'hsummer_missing_author';
      end if;
    else
      new.created_by := actor;
      new.created_at := pg_catalog.now();

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('hsummer-memory-rate:' || actor::text, 0)
      );

      select count(*)::integer
        into recent
      from public.memories
      where created_by = actor
        and created_at > pg_catalog.now() - interval '10 minutes';

      if recent >= 10 then
        raise exception 'hsummer_rate_limited';
      end if;
    end if;
  else
    if old.kind = 'letter' or new.kind = 'letter' then
      if new.kind is distinct from old.kind
         or new.letter_id is distinct from old.letter_id
         or new.checkpoint_id is distinct from old.checkpoint_id
         or new.booth_session_id is distinct from old.booth_session_id
         or new.visibility is distinct from 'selected'
         or new.body is distinct from old.body
         or new.tags is distinct from old.tags
         or new.occurred_on is distinct from old.occurred_on
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
      then
        raise exception 'hsummer_letter_memory';
      end if;
    end if;

    if old.kind = 'milestone' or new.kind = 'milestone' then
      if new.kind is distinct from old.kind
         or new.checkpoint_id is distinct from old.checkpoint_id
         or new.letter_id is distinct from old.letter_id
         or new.booth_session_id is distinct from old.booth_session_id
         or new.visibility is distinct from 'circle'
         or new.body is distinct from old.body
         or new.tags is distinct from old.tags
         or new.occurred_on is distinct from old.occurred_on
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
      then
        raise exception 'hsummer_checkpoint_memory';
      end if;
    end if;

    if old.kind = 'photo-strip' or new.kind = 'photo-strip' then
      if new.kind is distinct from old.kind
         or new.booth_session_id is distinct from old.booth_session_id
         or new.letter_id is distinct from old.letter_id
         or new.checkpoint_id is distinct from old.checkpoint_id
         or new.visibility is distinct from 'circle'
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
      then
        raise exception 'hsummer_booth_memory';
      end if;
    end if;

    if actor is not null then
      if new.id is distinct from old.id
         or new.circle_id is distinct from old.circle_id
         or new.kind is distinct from old.kind
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
         or new.created_by is distinct from old.created_by
         or new.created_at is distinct from old.created_at
         or new.letter_id is distinct from old.letter_id
         or new.checkpoint_id is distinct from old.checkpoint_id
         or new.booth_session_id is distinct from old.booth_session_id
      then
        raise exception 'hsummer_memory_locked';
      end if;
    end if;
  end if;

  new.updated_at := pg_catalog.now();

  if new.photo_bytes > 0 then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hsummer-memory-quota:' || new.circle_id::text,
        0
      )
    );

    select coalesce(sum(photo_bytes), 0)::integer
      into used
    from public.memories
    where circle_id = new.circle_id;

    if tg_op = 'UPDATE' and old.circle_id = new.circle_id then
      used := used - old.photo_bytes;
    end if;

    if used + new.photo_bytes > 104857600 then
      raise exception 'hsummer_storage_quota';
    end if;
  end if;

  return new;
end;
$$;


comment on function private.memories_guard() is
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB. A letter memory is created only by open_letter. A milestone is created only while a checkpoint is being hit. A photo strip is created only by save_solo_booth, finish_pass_booth, or finish_together_booth.';
