-- Week 15 Pass the Booth.
--
-- Additive on top of 20270104120000_solo_booth.sql.
-- Safe to run once against a database that already has weeks 1–13.
-- Do not edit or re-run those files.
--
-- This adds an async booth: one person shoots their frames, the other
-- shoots theirs later. A photo-strip memory is created only when every
-- frame is filled. Live Together is not in this file. Nothing writes
-- capture_at or ready_at.
--
-- The app passes one other active member as the partner. The kind of circle
-- is not read. A third member is included only when a caller names them as
-- the partner. Until then they cannot read an open pass, upload a frame, or
-- finish it. A finished strip stays visibility circle, so every active
-- member can see it on the wall.
--
-- Regions are unchanged. Supabase stays in Oregon (us-west-2). Vercel stays
-- in pdx1. Upstash Redis, when it is set, stays in us-west-2. No new bucket
-- and no new environment variable.
--
-- The Supabase editor may warn that some statements look destructive.
-- None of them delete a memory, a letter, a finished strip, or a circle.
--   * CREATE OR REPLACE FUNCTION replaces memories_guard,
--     can_read_booth_object, and can_upload_booth_object. The triggers and
--     policies that call them stay in place. Existing rows are not updated
--     by the replace.
--   * DROP POLICY replaces three select policies so an open pass is visible
--     to its two contributors. A solo session and a finished pass stay
--     visible to every active member. Dropping the policy does not delete
--     rows.
--   * DELETE FROM booth_shots runs only for a pass that is being cancelled
--     or has expired, and only from those functions. The shot trigger then
--     deletes that frame's JPEG. A complete session is not in that delete.
--   * DELETE FROM booth_sessions runs only from discard_pass_booth, and only
--     for an open pass whose partner has not added a frame. That is the
--     rollback when the starter's upload fails. No memory row exists yet.
--   * DELETE FROM storage.objects removes a booth JPEG that has no shot row
--     and is older than 24 hours. The path has to be
--     {circle}/{session}/{position}.jpg. A memory photo is a different path
--     and is not matched. A frame that still has a shot row is not matched.

-- ---------------------------------------------------------------------------
-- Caption on the session, copied onto the memory when the strip is finished
-- ---------------------------------------------------------------------------
--
-- Week 13 granted select on the whole booth_sessions table. This column is
-- not a secret, so that grant is left as it is. Authenticated still has no
-- insert, update, or delete on the booth tables.

alter table public.booth_sessions
  add column caption text;

alter table public.booth_sessions
  add constraint booth_sessions_caption_length
  check (caption is null or char_length(caption) between 1 and 280);

comment on column public.booth_sessions.caption is
  'Optional line the starter wrote. Copied onto the photo-strip memory when the pass is finished. Null when they left it blank.';

comment on column public.booth_sessions.expires_at is
  'Pass the Booth: 7 days after it starts. Live Together is not set here.';

comment on column public.booth_sessions.mode is
  'solo, pass, or together. Week 15 inserts pass. Together is still unused.';

create index booth_sessions_pass_open_idx
  on public.booth_sessions (circle_id, expires_at)
  where mode = 'pass' and status = 'open';

-- ---------------------------------------------------------------------------
-- Who can read a frame
-- ---------------------------------------------------------------------------
--
-- CREATE OR REPLACE keeps the grants from week 13. It does not delete rows.

create or replace function private.can_read_booth_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.booth_shots as shot
    join public.booth_sessions as session on session.id = shot.session_id
    where shot.storage_path = object_name
      and private.is_active_member(session.circle_id)
      and (
        session.mode = 'solo'
        or session.status = 'complete'
        or exists (
          select 1
          from public.booth_contributors as contributor
          where contributor.session_id = session.id
            and contributor.user_id = (select auth.uid())
        )
      )
  );
$$;

comment on function private.can_read_booth_object(text) is
  'True when auth.uid() may sign this frame. A solo strip and a finished pass are the whole circle. An open, cancelled, or expired pass is only its contributors.';

create or replace function private.can_upload_booth_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.booth_shots as shot
    join public.booth_sessions as session on session.id = shot.session_id
    where shot.storage_path = object_name
      and shot.user_id = (select auth.uid())
      and private.is_active_member(session.circle_id)
      and (storage.foldername(object_name))[1] = session.circle_id::text
      and (
        (
          session.mode = 'solo'
          and session.created_by = (select auth.uid())
        )
        or (
          session.mode = 'pass'
          and session.status = 'open'
          and (
            session.expires_at is null
            or session.expires_at > pg_catalog.now()
          )
        )
      )
  );
$$;

comment on function private.can_upload_booth_object(text) is
  'True when the caller owns this shot row. Solo is the person who saved it. Pass is that contributor, and only while the session is still open.';

-- ---------------------------------------------------------------------------
-- Select policies
-- ---------------------------------------------------------------------------
--
-- DROP POLICY replaces the rule. It does not delete sessions or shots.

drop policy booth_sessions_select_member on public.booth_sessions;

create policy booth_sessions_select_member
  on public.booth_sessions
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and (
      mode = 'solo'
      or status = 'complete'
      or exists (
        select 1
        from public.booth_contributors as contributor
        where contributor.session_id = id
          and contributor.user_id = (select auth.uid())
      )
    )
  );

comment on policy booth_sessions_select_member on public.booth_sessions is
  'Active members read a solo session and a finished pass. An unfinished pass is only its contributors. There is still no insert grant.';

drop policy booth_contributors_select_member on public.booth_contributors;

create policy booth_contributors_select_member
  on public.booth_contributors
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.booth_sessions as session
      where session.id = session_id
        and private.is_active_member(session.circle_id)
        and (
          session.mode = 'solo'
          or session.status = 'complete'
          or exists (
            select 1
            from public.booth_contributors as mine
            where mine.session_id = session.id
              and mine.user_id = (select auth.uid())
          )
        )
    )
  );

comment on policy booth_contributors_select_member on public.booth_contributors is
  'Same visibility as the session. The kind of circle is not read.';

drop policy booth_shots_select_member on public.booth_shots;

create policy booth_shots_select_member
  on public.booth_shots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.booth_sessions as session
      where session.id = session_id
        and private.is_active_member(session.circle_id)
        and (
          session.mode = 'solo'
          or session.status = 'complete'
          or exists (
            select 1
            from public.booth_contributors as mine
            where mine.session_id = session.id
              and mine.user_id = (select auth.uid())
          )
        )
    )
  );

comment on policy booth_shots_select_member on public.booth_shots is
  'Contributors can read frames while a pass is open. Everyone in the circle can read them once it is complete.';

-- ---------------------------------------------------------------------------
-- Memory guard
-- ---------------------------------------------------------------------------
--
-- CREATE OR REPLACE replaces the function body. It does not delete memories.
-- A solo strip still has to be mode solo, status complete, and written by
-- its saver. A pass strip has to be mode pass, status complete, and written
-- by one of its contributors. Together is refused.

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
    elsif session_mode = 'pass' then
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
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB. A letter memory is created only by open_letter. A milestone is created only while a checkpoint is being hit. A photo strip is created only by save_solo_booth or finish_pass_booth.';

-- ---------------------------------------------------------------------------
-- Close an unfinished pass
-- ---------------------------------------------------------------------------

create function private.close_pass_shots(target_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.booth_shots
  where session_id = target_session;
end;
$$;

revoke all on function private.close_pass_shots(uuid)
  from public, anon, authenticated;

comment on function private.close_pass_shots(uuid) is
  'Deletes unfinished frames for one pass. The shot trigger deletes the JPEGs. Not granted to authenticated. Called only while cancelling or expiring.';

-- ---------------------------------------------------------------------------
-- Start
-- ---------------------------------------------------------------------------

create function public.create_pass_booth(
  target_circle uuid,
  partner_id uuid,
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
  expected integer;
  mine integer[];
  theirs integer[];
  shot_index integer;
  new_session uuid;
  paths text[] := '{}'::text[];
  caption text;
  recent integer;
  open_count integer;
begin
  actor := (select auth.uid());
  if actor is null
     or not private.is_active_member(target_circle)
     or partner_id is null
     or partner_id = actor
     or not private.is_active_member_user(target_circle, partner_id)
  then
    raise exception 'hsummer_booth_memory';
  end if;

  if target_theme not in ('kawaii', 'minimal')
     or target_filter not in ('none', 'bw', 'sepia', 'warm', 'cool', 'grain')
  then
    raise exception 'hsummer_booth_memory';
  end if;

  if target_layout = '4-cut' then
    expected := 4;
    mine := array[0, 1]::integer[];
    theirs := array[2, 3]::integer[];
  elsif target_layout = '2-cut' then
    expected := 2;
    mine := array[0]::integer[];
    theirs := array[1]::integer[];
  else
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
    id,
    circle_id,
    created_by,
    mode,
    theme,
    frame_layout,
    status,
    expires_at,
    caption
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

  insert into public.booth_contributors (
    session_id,
    user_id,
    assigned_positions,
    filter_id
  ) values
    (new_session, actor, mine, target_filter),
    (new_session, partner_id, theirs, 'none');

  for shot_index in 1..pg_catalog.cardinality(mine) loop
    insert into public.booth_shots (
      session_id,
      user_id,
      position,
      storage_path,
      byte_size
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
    'positions', to_jsonb(mine),
    'paths', to_jsonb(paths)
  );
end;
$$;

revoke all on function public.create_pass_booth(uuid, uuid, text, text, text, text, integer[])
  from public, anon, authenticated;

grant execute on function public.create_pass_booth(uuid, uuid, text, text, text, text, integer[])
  to authenticated;

comment on function public.create_pass_booth(uuid, uuid, text, text, text, text, integer[]) is
  'Starts a pass for the caller and one other active member. The caller fills the top frames. The partner fills the rest. No memory yet. Expires in 7 days. At most 3 open passes in a circle, and 10 starts per 10 minutes.';

-- ---------------------------------------------------------------------------
-- The partner's frames
-- ---------------------------------------------------------------------------

create function public.submit_pass_shots(
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

  select session.mode, session.status, session.expires_at, session.circle_id
    into session_mode, session_status, session_expires, session_circle
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'pass'
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

  if session_status = 'cancelled' then
    return pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  if session_status = 'expired'
     or (
       session_status = 'open'
       and session_expires is not null
       and session_expires <= pg_catalog.now()
     )
  then
    update public.booth_sessions
      set status = 'expired'
    where id = target_session
      and status = 'open';
    perform private.close_pass_shots(target_session);
    return pg_catalog.jsonb_build_object(
      'status', 'expired',
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  if session_status is distinct from 'open' then
    return pg_catalog.jsonb_build_object(
      'status', session_status,
      'paths', '[]'::jsonb,
      'already', false
    );
  end if;

  -- The column list names the unnest output. A bare alias would be the
  -- row name, and array_agg(pos) would not see an integer column.
  select coalesce(pg_catalog.array_agg(pos order by pos), '{}'::integer[])
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
    select coalesce(pg_catalog.array_agg(shot.storage_path order by shot.position), '{}'::text[])
      into paths
    from public.booth_shots as shot
    where shot.session_id = target_session
      and shot.user_id = actor;
    return pg_catalog.jsonb_build_object(
      'status', 'open',
      'paths', to_jsonb(paths),
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
      session_id,
      user_id,
      position,
      storage_path,
      byte_size
    ) values (
      target_session,
      actor,
      mine[shot_index],
      paths[shot_index],
      shot_sizes[shot_index]
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'open',
    'paths', to_jsonb(paths),
    'already', false
  );
end;
$$;

revoke all on function public.submit_pass_shots(uuid, text, integer[])
  from public, anon, authenticated;

grant execute on function public.submit_pass_shots(uuid, text, integer[])
  to authenticated;

comment on function public.submit_pass_shots(uuid, text, integer[]) is
  'Records the caller''s assigned frames on an open pass. A non-contributor gets nothing. An expired pass is closed instead of accepting frames.';

-- ---------------------------------------------------------------------------
-- Finish, once every position has a frame
-- ---------------------------------------------------------------------------

create function public.finish_pass_booth(target_session uuid)
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
  session_caption text;
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
    session.frame_layout,
    session.caption
    into
      session_mode,
      session_status,
      session_expires,
      session_circle,
      session_layout,
      session_caption
  from public.booth_sessions as session
  where session.id = target_session
  for update;

  if not found
     or session_mode is distinct from 'pass'
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

  if session_status = 'cancelled' then
    return pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'memory_id', null
    );
  end if;

  if session_status = 'expired'
     or (
       session_status = 'open'
       and session_expires is not null
       and session_expires <= pg_catalog.now()
     )
  then
    update public.booth_sessions
      set status = 'expired'
    where id = target_session
      and status = 'open';
    perform private.close_pass_shots(target_session);
    return pg_catalog.jsonb_build_object(
      'status', 'expired',
      'memory_id', null
    );
  end if;

  if session_status is distinct from 'open' then
    return pg_catalog.jsonb_build_object(
      'status', session_status,
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

  if shot_count < expected then
    return pg_catalog.jsonb_build_object(
      'status', 'open',
      'memory_id', null
    );
  end if;

  update public.booth_sessions
    set status = 'complete'
  where id = target_session
    and status = 'open';

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
    session_caption,
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

revoke all on function public.finish_pass_booth(uuid)
  from public, anon, authenticated;

grant execute on function public.finish_pass_booth(uuid)
  to authenticated;

comment on function public.finish_pass_booth(uuid) is
  'When every frame is in, marks the pass complete and inserts one circle-visible photo-strip memory. Safe to call again. A non-contributor cannot call it.';

-- ---------------------------------------------------------------------------
-- Cancel, discard a failed start, expire
-- ---------------------------------------------------------------------------

create function public.cancel_pass_booth(target_session uuid)
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
     or session_mode is distinct from 'pass'
     or session_owner is distinct from actor
     or not private.is_active_member(session_circle)
     or session_status is distinct from 'open'
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

revoke all on function public.cancel_pass_booth(uuid)
  from public, anon, authenticated;

grant execute on function public.cancel_pass_booth(uuid)
  to authenticated;

comment on function public.cancel_pass_booth(uuid) is
  'The starter cancels an open pass. Frames already uploaded are removed. The partner cannot cancel it.';

create function public.discard_pass_booth(target_session uuid)
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

  select session.mode, session.status, session.created_by, session.circle_id
    into session_mode, session_status, session_owner, session_circle
  from public.booth_sessions as session
  where session.id = target_session;

  if not found
     or session_mode is distinct from 'pass'
     or session_owner is distinct from actor
     or not private.is_active_member(session_circle)
     or session_status is distinct from 'open'
     or exists (
       select 1
       from public.booth_shots as shot
       where shot.session_id = target_session
         and shot.user_id is distinct from actor
     )
  then
    raise exception 'hsummer_booth_memory';
  end if;

  delete from public.booth_sessions
  where id = target_session
    and status = 'open'
    and created_by = actor;

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.discard_pass_booth(uuid)
  from public, anon, authenticated;

grant execute on function public.discard_pass_booth(uuid)
  to authenticated;

comment on function public.discard_pass_booth(uuid) is
  'Deletes an open pass the starter could not upload. Used only when their own frames failed to land. Refuses once the partner has a frame.';

create function public.release_pass_shots(target_session uuid)
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
     or session_mode is distinct from 'pass'
     or session_status is distinct from 'open'
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

revoke all on function public.release_pass_shots(uuid)
  from public, anon, authenticated;

grant execute on function public.release_pass_shots(uuid)
  to authenticated;

comment on function public.release_pass_shots(uuid) is
  'Removes the caller''s frames from an open pass when their upload failed. The partner''s frames stay.';

create function public.expire_pass_booths(target_circle uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  closed_count integer := 0;
begin
  actor := (select auth.uid());
  if actor is null or not private.is_active_member(target_circle) then
    raise exception 'hsummer_booth_memory';
  end if;

  with closed as (
    update public.booth_sessions
      set status = 'expired'
    where circle_id = target_circle
      and mode = 'pass'
      and status = 'open'
      and expires_at is not null
      and expires_at <= pg_catalog.now()
    returning id
  )
  select count(*)::integer
    into closed_count
  from closed;

  delete from public.booth_shots as shot
  using public.booth_sessions as session
  where shot.session_id = session.id
    and session.circle_id = target_circle
    and session.mode = 'pass'
    and session.status in ('expired', 'cancelled');

  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = 'memories'
    and name ~ (
      '^'
      || target_circle::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-3]\.jpg$'
    )
    and created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1
      from public.booth_shots as shot
      where shot.storage_path = storage.objects.name
    );

  return closed_count;
end;
$$;

revoke all on function public.expire_pass_booths(uuid)
  from public, anon, authenticated;

grant execute on function public.expire_pass_booths(uuid)
  to authenticated;

comment on function public.expire_pass_booths(uuid) is
  'Closes open passes in this circle whose 7 days are up, removes those unfinished frames, and deletes booth JPEGs with no shot row older than 24 hours. Safe to call on every page load. Returns how many just expired.';
