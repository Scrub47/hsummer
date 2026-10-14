-- Week 8 memory wall.
--
-- Additive on top of 20261123120000_current_moods.sql.
-- Safe to run once against a database that already has weeks 1–7.
-- Do not edit or re-run those files.
--
-- This adds:
--   * public.memories — a photo or a note on a circle's wall
--   * public.memory_viewers — who may see a row when visibility is selected
--   * a private Storage bucket, memories, created here. Do not also click
--     New bucket. Object names are {circle id}/{memory id}.jpg|png|webp.
--
-- visibility circle: every active member can read the row.
-- visibility selected: the author, plus active members listed in
-- memory_viewers. The author is not stored as a viewer.
-- circle_type is not read by these policies.
--
-- Photos are limited to 2 MB each and 100 MB per circle (photo_bytes).
-- Notes do not count toward that quota. Inserts are limited to 10 per
-- person per 10 minutes. The app strips EXIF before upload and asks
-- Storage for a signed URL that lasts 5 minutes.

-- ---------------------------------------------------------------------------
-- Tag shape
-- ---------------------------------------------------------------------------

create function private.memory_tags_ok(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.cardinality(tags), 0) <= 8
    and not exists (
      select 1
      from pg_catalog.unnest(coalesce(tags, '{}'::text[])) as tag
      where tag !~ '^[a-z0-9][a-z0-9 -]{0,23}$'
    );
$$;

revoke all on function private.memory_tags_ok(text[])
  from public, anon, authenticated;

-- A check constraint runs as the inserting role. authenticated writes rows.
-- service_role seeds rows in tests and bypasses RLS, but not this check.
grant execute on function private.memory_tags_ok(text[])
  to authenticated, service_role;

comment on function private.memory_tags_ok(text[]) is
  'At most 8 tags. Each is 1–24 lowercase letters, numbers, spaces, or hyphens, and cannot contain @.';

-- ---------------------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------------------

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- Null after the author's account is deleted ("Former member").
  created_by uuid references public.profiles (id) on delete set null,
  kind text not null,
  body text,
  photo_path text,
  photo_bytes integer not null default 0,
  tags text[] not null default '{}'::text[],
  visibility text not null default 'circle',
  -- Calendar date the memory is filed under. No time and no zone.
  occurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memories_kind_known check (kind in ('photo', 'note')),
  constraint memories_visibility_known check (
    visibility in ('circle', 'selected')
  ),
  constraint memories_body_shape check (
    body is null or char_length(body) between 1 and 2000
  ),
  constraint memories_photo_shape check (
    (
      kind = 'note'
      and photo_path is null
      and photo_bytes = 0
      and body is not null
    )
    or (
      kind = 'photo'
      and photo_bytes between 1 and 2097152
      and photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and (body is null or char_length(body) <= 280)
    )
  ),
  constraint memories_occurred_on_sane check (
    occurred_on >= date '1900-01-01'
    and occurred_on <= (current_date + 1)
  ),
  constraint memories_tags_ok check (private.memory_tags_ok(tags)),
  constraint memories_photo_path_unique unique (photo_path)
);

comment on table public.memories is
  'A photo or a note on one circle''s wall. Active members read it when visibility is circle. Selected rows are the author plus memory_viewers.';

comment on column public.memories.kind is
  'photo or note. A note has no object. A photo may have a short caption in body.';

comment on column public.memories.photo_path is
  'Null for a note. Otherwise {circle id}/{memory id}.jpg|png|webp in the private memories bucket.';

comment on column public.memories.photo_bytes is
  'Size of the stored photo after EXIF is removed. Notes are 0. The circle quota is the sum, capped at 100 MB.';

comment on column public.memories.visibility is
  'circle (every active member) or selected (the author, plus memory_viewers who are still active).';

comment on column public.memories.occurred_on is
  'The calendar date the wall groups by. Not a timestamp.';

comment on column public.memories.created_by is
  'Who added it. Null means that account was deleted and the UI says Former member.';

create index memories_circle_occurred_idx
  on public.memories (circle_id, occurred_on desc, created_at desc);

alter table public.memories enable row level security;

-- Realtime sends the old row on update and delete, including circle_id,
-- so a filtered subscription still matches those events.
alter table public.memories replica identity full;

revoke all on table public.memories from public, anon, authenticated;

grant select on table public.memories to authenticated;

-- created_by, created_at, and updated_at are the trigger's.
grant insert (
  id,
  circle_id,
  kind,
  body,
  photo_path,
  photo_bytes,
  tags,
  visibility,
  occurred_on
) on table public.memories to authenticated;

grant update (
  body,
  tags,
  visibility,
  occurred_on
) on table public.memories to authenticated;

grant delete on table public.memories to authenticated;

-- Bytes already filed on this circle. Null when the caller is not a member,
-- so an outsider does not learn the number. Notes count as zero.
create function public.circle_memory_bytes(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_active_member(target) then (
      select coalesce(sum(photo_bytes), 0)::integer
      from public.memories
      where circle_id = target
    )
    else null
  end;
$$;

revoke all on function public.circle_memory_bytes(uuid)
  from public, anon, authenticated;

grant execute on function public.circle_memory_bytes(uuid) to authenticated;

comment on function public.circle_memory_bytes(uuid) is
  'Sum of photo_bytes for one circle. Null unless the caller is an active member. The cap is 104857600 (100 MB).';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
--
-- Select is added after memory_viewers exists. It uses the row's own
-- columns plus private.is_memory_viewer, which does not read memories
-- again. A policy that re-reads memories hides the new row from
-- INSERT ... RETURNING. Storage uses private.can_read_memory instead.

create policy memories_insert_member
  on public.memories
  for insert
  to authenticated
  with check (
    private.is_active_member(circle_id)
    and created_by = (select auth.uid())
  );

comment on policy memories_insert_member on public.memories is
  'An active member adds a row as themselves. The trigger stamps created_by.';

create policy memories_update_author
  on public.memories
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and private.is_active_member(circle_id)
  )
  with check (
    created_by = (select auth.uid())
    and private.is_active_member(circle_id)
  );

comment on policy memories_update_author on public.memories is
  'Only the author can change a memory, and only while they are still an active member.';

create policy memories_delete_author
  on public.memories
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and private.is_active_member(circle_id)
  );

comment on policy memories_delete_author on public.memories is
  'Only the author can remove a memory. The delete trigger removes the photo object.';

-- ---------------------------------------------------------------------------
-- Insert and update guard
-- ---------------------------------------------------------------------------

create function private.memories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
  used integer;
  actor uuid;
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
      select pg_catalog.array_agg(distinct tag)
      from (
        select pg_catalog.lower(pg_catalog.btrim(tag)) as tag
        from pg_catalog.unnest(coalesce(new.tags, '{}'::text[])) as tag
      ) cleaned
      where tag <> ''
    ),
    '{}'::text[]
  );

  if new.kind = 'note' then
    new.photo_path := null;
    new.photo_bytes := 0;
  elsif new.kind = 'photo' then
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
    if actor is null then
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
    if actor is not null then
      if new.id is distinct from old.id
         or new.circle_id is distinct from old.circle_id
         or new.kind is distinct from old.kind
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
         or new.created_by is distinct from old.created_by
         or new.created_at is distinct from old.created_at
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

    -- 100 MB. Equal to the cap is allowed; one more byte is not.
    if used + new.photo_bytes > 104857600 then
      raise exception 'hsummer_storage_quota';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.memories_guard()
  from public, anon, authenticated;

create trigger memories_guard
  before insert or update on public.memories
  for each row
  execute function private.memories_guard();

comment on function private.memories_guard() is
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB of photo_bytes.';

-- Removing the row removes the object. A signed URL for that path then fails
-- because the object is gone, and an expired URL fails on its own.
create function private.memories_remove_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.photo_path is not null then
    -- storage.protect_delete blocks a direct delete unless the Storage
    -- API set this. The row is already going away, so the object goes too.
    perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
    where bucket_id = 'memories'
      and name = old.photo_path;
  end if;
  return old;
end;
$$;

revoke all on function private.memories_remove_photo()
  from public, anon, authenticated;

create trigger memories_remove_photo
  after delete on public.memories
  for each row
  execute function private.memories_remove_photo();

comment on function private.memories_remove_photo() is
  'Deletes the private object when its memory row goes away.';

-- ---------------------------------------------------------------------------
-- memory_viewers
-- ---------------------------------------------------------------------------

create table public.memory_viewers (
  memory_id uuid not null references public.memories (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (memory_id, user_id)
);

comment on table public.memory_viewers is
  'Active members allowed to read one selected memory. The author is not a row. Circle-visible memories have no rows.';

create index memory_viewers_circle_idx
  on public.memory_viewers (circle_id);

-- security definer so the memories select policy can see a viewer row
-- without applying memory_viewers RLS (that policy reads memories).
create function private.is_memory_viewer(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memory_viewers as viewer
    where viewer.memory_id = target
      and viewer.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_memory_viewer(uuid)
  from public, anon, authenticated;

grant execute on function private.is_memory_viewer(uuid) to authenticated;

comment on function private.is_memory_viewer(uuid) is
  'True when auth.uid() has a memory_viewers row for this memory.';

-- security definer so a storage policy can call it without depending on
-- the caller's ability to join memory_viewers under RLS.
create function private.can_read_memory(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memories as memory
    where memory.id = target
      and private.is_active_member(memory.circle_id)
      and (
        memory.visibility = 'circle'
        or memory.created_by = (select auth.uid())
        or exists (
          select 1
          from public.memory_viewers as viewer
          where viewer.memory_id = memory.id
            and viewer.user_id = (select auth.uid())
        )
      )
  );
$$;

revoke all on function private.can_read_memory(uuid)
  from public, anon, authenticated;

grant execute on function private.can_read_memory(uuid) to authenticated;

comment on function private.can_read_memory(uuid) is
  'True when auth.uid() is an active member and the row is circle-visible, theirs, or lists them in memory_viewers.';

create policy memories_select_visible
  on public.memories
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and (
      visibility = 'circle'
      or created_by = (select auth.uid())
      or private.is_memory_viewer(id)
    )
  );

comment on policy memories_select_visible on public.memories is
  'Active members read circle rows. Selected rows are the author and the listed viewers. An outsider and a member who left get nothing. The check uses this row, so INSERT ... RETURNING can see it.';

alter table public.memory_viewers enable row level security;

revoke all on table public.memory_viewers from public, anon, authenticated;

grant select on table public.memory_viewers to authenticated;

grant insert (memory_id, circle_id, user_id)
  on table public.memory_viewers to authenticated;

grant delete on table public.memory_viewers to authenticated;

create policy memory_viewers_select_author_or_self
  on public.memory_viewers
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and (
      user_id = (select auth.uid())
      or exists (
        select 1
        from public.memories as memory
        where memory.id = memory_id
          and memory.created_by = (select auth.uid())
      )
    )
  );

comment on policy memory_viewers_select_author_or_self on public.memory_viewers is
  'The author sees who they picked. A listed person sees their own row. Nobody else sees the list.';

create policy memory_viewers_insert_author
  on public.memory_viewers
  for insert
  to authenticated
  with check (
    user_id is distinct from (select auth.uid())
    and private.is_active_member(circle_id)
    and exists (
      select 1
      from public.memories as memory
      where memory.id = memory_id
        and memory.circle_id = memory_viewers.circle_id
        and memory.created_by = (select auth.uid())
        and memory.visibility = 'selected'
        and private.is_active_member_user(memory.circle_id, user_id)
    )
  );

comment on policy memory_viewers_insert_author on public.memory_viewers is
  'The author adds an active member, not themselves, and only on a selected memory.';

create policy memory_viewers_delete_author
  on public.memory_viewers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.memories as memory
      where memory.id = memory_id
        and memory.created_by = (select auth.uid())
        and private.is_active_member(memory.circle_id)
    )
  );

comment on policy memory_viewers_delete_author on public.memory_viewers is
  'The author can take someone off the list. A viewer cannot.';

create function private.memory_viewers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_circle uuid;
  found_author uuid;
  found_visibility text;
begin
  select circle_id, created_by, visibility
    into found_circle, found_author, found_visibility
  from public.memories
  where id = new.memory_id;

  if not found then
    raise exception 'hsummer_memory_missing';
  end if;

  if new.circle_id is distinct from found_circle then
    raise exception 'hsummer_memory_circle';
  end if;

  if found_visibility is distinct from 'selected' then
    raise exception 'hsummer_memory_visibility';
  end if;

  if new.user_id = found_author then
    raise exception 'hsummer_memory_viewer';
  end if;

  if not private.is_active_member_user(found_circle, new.user_id) then
    raise exception 'hsummer_memory_viewer';
  end if;

  update public.memories
  set updated_at = pg_catalog.now()
  where id = new.memory_id;

  return new;
end;
$$;

revoke all on function private.memory_viewers_guard()
  from public, anon, authenticated;

create trigger memory_viewers_guard
  before insert on public.memory_viewers
  for each row
  execute function private.memory_viewers_guard();

comment on function private.memory_viewers_guard() is
  'Checks the viewer is another active member of that memory''s circle, and bumps the memory so Realtime notices.';

-- ---------------------------------------------------------------------------
-- memories bucket
-- ---------------------------------------------------------------------------
--
-- Private. The browser never receives a public object URL. The server asks
-- Storage for a signed URL that lasts 5 minutes, and only after
-- can_read_memory would allow the read. There is no update policy.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'memories',
  'memories',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy memories_objects_select_visible
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'memories'
    and exists (
      select 1
      from public.memories as memory
      where memory.photo_path = name
        and private.can_read_memory(memory.id)
    )
  );

comment on policy memories_objects_select_visible on storage.objects is
  'Same visibility as the memory row. Signing a URL requires this select. An expired signature stops working on its own.';

create policy memories_objects_insert_author
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'memories'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and exists (
      select 1
      from public.memories as memory
      where memory.photo_path = name
        and memory.created_by = (select auth.uid())
        and private.is_active_member(memory.circle_id)
        and (storage.foldername(name))[1] = memory.circle_id::text
    )
  );

comment on policy memories_objects_insert_author on storage.objects is
  'The author uploads into a path that already matches their memory row. There is no update policy.';

create policy memories_objects_delete_author
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'memories'
    and exists (
      select 1
      from public.memories as memory
      where memory.photo_path = name
        and memory.created_by = (select auth.uid())
    )
  );

comment on policy memories_objects_delete_author on storage.objects is
  'The author can delete the object. The row delete trigger does the same.';

-- A second cap, using the object size Storage recorded. Avatars and backups
-- return immediately. A memories object with no recorded size counts as 0
-- here; photo_bytes on the row is still capped at 100 MB.
create function private.memories_object_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  incoming bigint;
  used bigint;
  circle text;
begin
  if new.bucket_id is distinct from 'memories' then
    return new;
  end if;

  begin
    incoming := coalesce(
      nullif(new.metadata ->> 'size', '')::bigint,
      nullif(new.metadata ->> 'contentLength', '')::bigint,
      0
    );
  exception
    when others then
      incoming := 0;
  end;

  circle := (storage.foldername(new.name))[1];
  if circle is null or circle = '' then
    raise exception 'hsummer_memory_path';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-memory-object:' || circle, 0)
  );

  select coalesce(sum(
    case
      when (metadata ->> 'size') ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
      when (metadata ->> 'contentLength') ~ '^[0-9]+$'
        then (metadata ->> 'contentLength')::bigint
      else 0
    end
  ), 0)
    into used
  from storage.objects
  where bucket_id = 'memories'
    and (storage.foldername(name))[1] = circle;

  if used + incoming > 104857600 then
    raise exception 'hsummer_storage_quota';
  end if;

  return new;
end;
$$;

revoke all on function private.memories_object_quota()
  from public, anon, authenticated;

create trigger memories_object_quota
  before insert on storage.objects
  for each row
  execute function private.memories_object_quota();

comment on function private.memories_object_quota() is
  'Caps the memories bucket at 100 MB of recorded object bytes per circle. Other buckets are ignored.';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Hosted Supabase already has the supabase_realtime publication. Adding the
-- table here is the same switch as the dashboard toggle. If that publication
-- does not exist yet, skip; enable Realtime for memories in the dashboard
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
      and tablename = 'memories'
  ) then
    alter publication supabase_realtime add table public.memories;
  end if;
end
$$;
