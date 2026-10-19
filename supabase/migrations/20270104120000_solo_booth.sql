-- Week 13 Solo Booth.
--
-- Additive on top of 20261228120000_still_us.sql.
-- Safe to run once against a database that already has weeks 1–12.
-- Do not edit or re-run those files.
--
-- This adds:
--   * public.booth_sessions, booth_contributors, booth_shots
--   * public.save_solo_booth, which creates the session and one
--     photo-strip memory in a single transaction
--   * memories.kind 'photo-strip' and memories.booth_session_id
--   * storage policies so those JPEGs stay in the private memories bucket
--
-- Shooting does not call this. A row exists only after Save to circle.
-- Pass the Booth and Live Together are not created here. The mode and
-- status checks already name them so a later week can insert those rows
-- without replacing this check.
--
-- A finished strip is visibility circle: every active member can read it.
-- The kind of circle is not read by these policies.
--
-- The Supabase editor may warn that some statements look destructive.
-- None of them delete a memory, a letter, a photo, or a circle.
--   * DROP CONSTRAINT memories_kind_known and memories_photo_shape replace
--     those two checks so a memory can be a photo strip. Existing photo,
--     note, letter, and milestone rows still match the new checks.
--   * CREATE OR REPLACE FUNCTION replaces memories_guard and
--     memories_remove_photo. The triggers that call them stay in place.
--   * REVOKE ALL runs only on the new tables and functions, before their
--     grants. It clears the default public privilege on those new objects.
--     It does not take any privilege away from memories or any older table.

-- ---------------------------------------------------------------------------
-- Sessions, contributors, shots
-- ---------------------------------------------------------------------------

create table public.booth_sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  mode text not null,
  theme text not null,
  frame_layout text not null,
  status text not null default 'complete',
  capture_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booth_sessions_mode_known check (
    mode in ('solo', 'pass', 'together')
  ),
  constraint booth_sessions_theme_known check (
    theme in ('kawaii', 'minimal')
  ),
  constraint booth_sessions_layout_known check (
    frame_layout in ('4-cut', '2-cut')
  ),
  constraint booth_sessions_status_known check (
    status in ('open', 'ready', 'capturing', 'complete', 'cancelled', 'expired')
  )
);

comment on table public.booth_sessions is
  'A photo booth tied to one circle. Solo creates the row at save time, already complete. Pass and Live Together are later modes.';

comment on column public.booth_sessions.mode is
  'solo, pass, or together. Week 13 only inserts solo.';

comment on column public.booth_sessions.theme is
  'kawaii or minimal. Retro Film is a later theme.';

comment on column public.booth_sessions.created_by is
  'Who saved it. Null means that account was deleted and the UI says Former member.';

create index booth_sessions_circle_idx
  on public.booth_sessions (circle_id, created_at desc);

alter table public.booth_sessions enable row level security;

revoke all on table public.booth_sessions from public, anon, authenticated;

grant select on table public.booth_sessions to authenticated;

create table public.booth_contributors (
  session_id uuid not null references public.booth_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_positions integer[] not null,
  filter_id text not null default 'none',
  ready_at timestamptz,
  primary key (session_id, user_id),
  constraint booth_contributors_positions_shape check (
    pg_catalog.cardinality(assigned_positions) between 1 and 4
  ),
  constraint booth_contributors_filter_known check (
    filter_id in ('none', 'bw', 'sepia', 'warm', 'cool', 'grain')
  )
);

comment on table public.booth_contributors is
  'Who fills which frames. Solo has one row, and assigned_positions covers every frame.';

comment on column public.booth_contributors.ready_at is
  'Live Together, later. Solo leaves it null.';

alter table public.booth_contributors enable row level security;

revoke all on table public.booth_contributors from public, anon, authenticated;

grant select on table public.booth_contributors to authenticated;

create table public.booth_shots (
  session_id uuid not null references public.booth_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null,
  storage_path text not null,
  byte_size integer not null,
  primary key (session_id, position),
  constraint booth_shots_position_known check (position between 0 and 3),
  constraint booth_shots_bytes_known check (byte_size between 1 and 2097152),
  constraint booth_shots_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-3]\.jpg$'
  ),
  constraint booth_shots_path_unique unique (storage_path),
  constraint booth_shots_contributor_fkey
    foreign key (session_id, user_id)
    references public.booth_contributors (session_id, user_id)
    on delete cascade
);

comment on table public.booth_shots is
  'One JPEG per frame, in the private memories bucket. The strip is drawn again from these files. No combined image is stored.';

comment on column public.booth_shots.storage_path is
  '{circle id}/{session id}/{position}.jpg. Position 0 is the top frame.';

comment on column public.booth_shots.byte_size is
  'Size after EXIF is removed. Counted in the circle photo quota through the memory row.';

create index booth_shots_user_idx
  on public.booth_shots (user_id);

alter table public.booth_shots enable row level security;

revoke all on table public.booth_shots from public, anon, authenticated;

grant select on table public.booth_shots to authenticated;

-- ---------------------------------------------------------------------------
-- Who can read a session
-- ---------------------------------------------------------------------------

create policy booth_sessions_select_member
  on public.booth_sessions
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy booth_sessions_select_member on public.booth_sessions is
  'Every active member can read a saved session. An outsider and a member who left get nothing. There is no insert grant; save_solo_booth writes the row.';

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
    )
  );

comment on policy booth_contributors_select_member on public.booth_contributors is
  'Same circle as the session. The kind of circle is not read.';

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
    )
  );

comment on policy booth_shots_select_member on public.booth_shots is
  'Active members can read the frame paths. Signing a URL still goes through the storage policy.';

-- ---------------------------------------------------------------------------
-- Objects in the existing private memories bucket
-- ---------------------------------------------------------------------------

create function private.can_read_booth_object(object_name text)
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
  );
$$;

revoke all on function private.can_read_booth_object(text)
  from public, anon, authenticated;

grant execute on function private.can_read_booth_object(text) to authenticated;

comment on function private.can_read_booth_object(text) is
  'True when auth.uid() is an active member of the circle that owns this frame.';

create function private.can_upload_booth_object(object_name text)
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
      and session.created_by = (select auth.uid())
      and session.mode = 'solo'
      and private.is_active_member(session.circle_id)
      and (storage.foldername(object_name))[1] = session.circle_id::text
  );
$$;

revoke all on function private.can_upload_booth_object(text)
  from public, anon, authenticated;

grant execute on function private.can_upload_booth_object(text) to authenticated;

comment on function private.can_upload_booth_object(text) is
  'True when the caller saved this solo session and the object name is its frame path.';

create policy booth_objects_select_member
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'memories'
    and private.can_read_booth_object(name)
  );

comment on policy booth_objects_select_member on storage.objects is
  'Active members can sign a frame URL. The bucket stays private. A public URL does not work.';

create policy booth_objects_insert_author
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'memories'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-3]\.jpg$'
    and private.can_upload_booth_object(name)
  );

comment on policy booth_objects_insert_author on storage.objects is
  'The author uploads a JPEG into a path save_solo_booth already recorded. There is no update policy.';

create policy booth_objects_delete_author
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'memories'
    and private.can_upload_booth_object(name)
  );

comment on policy booth_objects_delete_author on storage.objects is
  'The author can delete a frame they uploaded. Removing the memory also deletes the objects from the trigger.';

-- ---------------------------------------------------------------------------
-- memories: one photo strip per session
-- ---------------------------------------------------------------------------
--
-- DROP CONSTRAINT replaces the check. It does not delete memories.
-- The new check still accepts every photo, note, letter, and milestone.

alter table public.memories
  add column booth_session_id uuid;

alter table public.memories
  add constraint memories_booth_session_id_fkey
  foreign key (booth_session_id) references public.booth_sessions (id);

create unique index memories_one_booth_idx
  on public.memories (booth_session_id)
  where booth_session_id is not null;

comment on column public.memories.booth_session_id is
  'Set only for kind photo-strip. One memory per session. Not granted to authenticated on insert; save_solo_booth writes it.';

comment on column public.memories.kind is
  'photo, note, letter, milestone, or photo-strip. A photo strip has no single object. The frames live on booth_shots. Visibility is circle.';

alter table public.memories drop constraint memories_kind_known;

alter table public.memories
  add constraint memories_kind_known
  check (kind in ('photo', 'note', 'letter', 'milestone', 'photo-strip'));

alter table public.memories drop constraint memories_photo_shape;

alter table public.memories
  add constraint memories_photo_shape
  check (
    (
      kind = 'note'
      and letter_id is null
      and checkpoint_id is null
      and booth_session_id is null
      and photo_path is null
      and photo_bytes = 0
      and body is not null
    )
    or (
      kind = 'photo'
      and letter_id is null
      and checkpoint_id is null
      and booth_session_id is null
      and photo_bytes between 1 and 2097152
      and photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and (body is null or char_length(body) <= 280)
    )
    or (
      kind = 'letter'
      and letter_id is not null
      and checkpoint_id is null
      and booth_session_id is null
      and photo_path is null
      and photo_bytes = 0
      and (body is null or char_length(body) between 1 and 280)
    )
    or (
      kind = 'milestone'
      and checkpoint_id is not null
      and letter_id is null
      and booth_session_id is null
      and photo_path is null
      and photo_bytes = 0
      and body is not null
      and char_length(body) between 1 and 280
    )
    or (
      kind = 'photo-strip'
      and booth_session_id is not null
      and letter_id is null
      and checkpoint_id is null
      and photo_path is null
      and photo_bytes between 1 and 8388608
      and visibility = 'circle'
      and (body is null or char_length(body) <= 280)
    )
  );

-- ---------------------------------------------------------------------------
-- Guard
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

    select session.circle_id, session.created_by, session.mode
      into session_circle, session_owner, session_mode
    from public.booth_sessions as session
    where session.id = new.booth_session_id;

    if not found
       or session_circle is distinct from new.circle_id
       or session_mode is distinct from 'solo'
       or session_owner is distinct from new.created_by
       or actor is distinct from new.created_by
    then
      raise exception 'hsummer_booth_memory';
    end if;

    select coalesce(sum(shot.byte_size), 0)::integer
      into shot_bytes
    from public.booth_shots as shot
    where shot.session_id = new.booth_session_id;

    if shot_bytes is distinct from new.photo_bytes then
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
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB. A letter memory is created only by open_letter. A milestone is created only while a checkpoint is being hit. A photo strip is created only by save_solo_booth.';

-- ---------------------------------------------------------------------------
-- Removing a strip removes its frames
-- ---------------------------------------------------------------------------

create or replace function private.memories_remove_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.photo_path is not null then
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
    where bucket_id = 'memories'
      and name = old.photo_path;
  end if;

  if old.booth_session_id is not null
     and pg_catalog.current_setting('hsummer.booth_discard', true) is distinct from '1'
  then
    perform pg_catalog.set_config('hsummer.booth_discard', '1', true);
    delete from public.booth_sessions
    where id = old.booth_session_id;
  end if;

  return old;
end;
$$;

comment on function private.memories_remove_photo() is
  'Deletes the private photo when its memory row goes away. A photo strip also deletes the session, and the shot trigger deletes each frame.';

create function private.booth_shots_remove_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.storage_path is not null then
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
    where bucket_id = 'memories'
      and name = old.storage_path;
  end if;
  return old;
end;
$$;

revoke all on function private.booth_shots_remove_object()
  from public, anon, authenticated;

create trigger booth_shots_remove_object
  after delete on public.booth_shots
  for each row
  execute function private.booth_shots_remove_object();

comment on function private.booth_shots_remove_object() is
  'Deletes the private JPEG when its frame row goes away.';

create function private.booth_sessions_mark_discard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('hsummer.booth_discard', '1', true);
  return old;
end;
$$;

revoke all on function private.booth_sessions_mark_discard()
  from public, anon, authenticated;

create trigger booth_sessions_mark_discard
  before delete on public.booth_sessions
  for each row
  execute function private.booth_sessions_mark_discard();

comment on function private.booth_sessions_mark_discard() is
  'Stops the memory delete trigger from deleting this session a second time.';

-- ---------------------------------------------------------------------------
-- Save
-- ---------------------------------------------------------------------------

create function public.save_solo_booth(
  target_circle uuid,
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
  shot_index integer;
  total integer := 0;
  new_session uuid;
  new_memory uuid;
  positions integer[] := '{}'::integer[];
  paths text[] := '{}'::text[];
  filed date;
  caption text;
begin
  actor := (select auth.uid());
  if actor is null or not private.is_active_member(target_circle) then
    raise exception 'hsummer_booth_memory';
  end if;

  if target_theme not in ('kawaii', 'minimal') then
    raise exception 'hsummer_booth_memory';
  end if;

  if target_layout = '4-cut' then
    expected := 4;
  elsif target_layout = '2-cut' then
    expected := 2;
  else
    raise exception 'hsummer_booth_memory';
  end if;

  if target_filter not in ('none', 'bw', 'sepia', 'warm', 'cool', 'grain') then
    raise exception 'hsummer_booth_memory';
  end if;

  if shot_sizes is null
     or pg_catalog.cardinality(shot_sizes) is distinct from expected
  then
    raise exception 'hsummer_booth_memory';
  end if;

  new_session := gen_random_uuid();

  for shot_index in 1..expected loop
    if shot_sizes[shot_index] is null
       or shot_sizes[shot_index] < 1
       or shot_sizes[shot_index] > 2097152
    then
      raise exception 'hsummer_booth_memory';
    end if;
    total := total + shot_sizes[shot_index];
    positions := positions || (shot_index - 1);
    paths := paths || (
      target_circle::text
      || '/'
      || new_session::text
      || '/'
      || (shot_index - 1)::text
      || '.jpg'
    );
  end loop;

  caption := nullif(pg_catalog.btrim(coalesce(target_caption, '')), '');
  if caption is not null and pg_catalog.char_length(caption) > 280 then
    raise exception 'hsummer_booth_memory';
  end if;

  insert into public.booth_sessions (
    id,
    circle_id,
    created_by,
    mode,
    theme,
    frame_layout,
    status
  ) values (
    new_session,
    target_circle,
    actor,
    'solo',
    target_theme,
    target_layout,
    'complete'
  );

  insert into public.booth_contributors (
    session_id,
    user_id,
    assigned_positions,
    filter_id
  ) values (
    new_session,
    actor,
    positions,
    target_filter
  );

  for shot_index in 1..expected loop
    insert into public.booth_shots (
      session_id,
      user_id,
      position,
      storage_path,
      byte_size
    ) values (
      new_session,
      actor,
      shot_index - 1,
      paths[shot_index],
      shot_sizes[shot_index]
    );
  end loop;

  filed := private.viewer_local_date(actor);

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
    target_circle,
    actor,
    'photo-strip',
    caption,
    null,
    total,
    array['photo-booth']::text[],
    'circle',
    filed,
    new_session
  )
  returning id into new_memory;

  return pg_catalog.jsonb_build_object(
    'session_id', new_session,
    'memory_id', new_memory,
    'paths', to_jsonb(paths)
  );
end;
$$;

revoke all on function public.save_solo_booth(uuid, text, text, text, text, integer[])
  from public, anon, authenticated;

grant execute on function public.save_solo_booth(uuid, text, text, text, text, integer[])
  to authenticated;

comment on function public.save_solo_booth(uuid, text, text, text, text, integer[]) is
  'Saves a Solo Booth into the caller''s circle: one complete session, one contributor, every frame, and one circle-visible photo-strip memory. The JPEGs are uploaded after this returns.';
