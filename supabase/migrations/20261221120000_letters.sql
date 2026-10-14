-- Week 11 letters (Dear <name>).
--
-- Additive on top of 20261207120000_security_hardening.sql.
-- Safe to run once against a database that already has weeks 1–9.
-- Do not edit or re-run those files.
--
-- This adds:
--   * public.letter_categories — custom open-when labels for one circle
--   * public.letters — a letter from one member to one other member
--   * public.open_letter(uuid) — the recipient opens a delivered letter
--     and gets one members-only memory
--   * memories.kind 'letter' and memories.letter_id
--
-- Default categories live in the app and in private.letter_category_known.
-- They are not rows. A circle adds extra labels in letter_categories.
--
-- Who can read a letter: the sender, always; the recipient only once
-- delivered_at is set; nobody else in the circle. The circle's type is
-- not read by these policies.
--
-- Week 11 delivers on insert. The signed-in sender cannot set
-- scheduled_for, delivered_at, opened_at, status, or qstash_message_id.
-- The trigger stamps delivered_at. Week 12 is the QStash callback that
-- delivers a letter whose scheduled_for is in the future. This file does
-- not call QStash. A service_role insert may still plant a scheduled row
-- so the isolation tests can prove the recipient sees nothing before
-- delivered_at.
--
-- The SQL editor may flag DROP CONSTRAINT. Two checks on memories are
-- replaced so kind 'letter' is allowed. No row, policy, or bucket is
-- deleted. Photo and note rows still match the new checks. Run the file
-- as one script. CREATE TRIGGER is not repeatable. CREATE OR REPLACE
-- FUNCTION is. If it stops halfway, read the error before pasting again.

-- ---------------------------------------------------------------------------
-- letter_categories
-- ---------------------------------------------------------------------------

create table public.letter_categories (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  label text not null,
  -- Null after the author's account is deleted ("Former member").
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint letter_categories_label_shape check (
    char_length(label) between 1 and 40
    and position('@' in label) = 0
    and label ~ '^[A-Za-z0-9][A-Za-z0-9 ''-]{0,39}$'
  )
);

comment on table public.letter_categories is
  'Custom open-when labels for one circle. The seven defaults are not rows. Active members can read them. They are not letter bodies.';

comment on column public.letter_categories.label is
  'Shown in the category list. 1–40 letters, numbers, spaces, apostrophes, or hyphens. No @.';

create unique index letter_categories_label_idx
  on public.letter_categories (circle_id, lower(label));

create index letter_categories_circle_idx
  on public.letter_categories (circle_id, created_at desc);

alter table public.letter_categories enable row level security;

alter table public.letter_categories replica identity full;

revoke all on table public.letter_categories from public, anon, authenticated;

grant select on table public.letter_categories to authenticated;

-- created_by is granted so the insert can name the author. The trigger
-- rejects anyone except the signed-in user. created_at stays on its default.
grant insert (circle_id, label, created_by)
  on table public.letter_categories to authenticated;

grant delete on table public.letter_categories to authenticated;

grant select, insert, update, delete
  on table public.letter_categories to service_role;

-- ---------------------------------------------------------------------------
-- Known categories
-- ---------------------------------------------------------------------------

create function private.letter_category_known(c uuid, category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select category in (
    'need-motivation',
    'need-help',
    'feeling-sad',
    'feeling-lonely',
    'distance-is-too-hard',
    'when-we-fight',
    'when-you-miss-me'
  )
  or exists (
    select 1
    from public.letter_categories as custom
    where custom.circle_id = c
      and custom.label = category
  );
$$;

revoke all on function private.letter_category_known(uuid, text)
  from public, anon, authenticated;

comment on function private.letter_category_known(uuid, text) is
  'True for a default slug or a custom label stored for that circle. Not in the Data API.';

create function private.letter_category_is_default(label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(label) in (
    'need motivation',
    'need help',
    'feeling sad',
    'feeling lonely',
    'distance is too hard',
    'when we fight',
    'when you miss me',
    'need-motivation',
    'need-help',
    'feeling-sad',
    'feeling-lonely',
    'distance-is-too-hard',
    'when-we-fight',
    'when-you-miss-me'
  );
$$;

revoke all on function private.letter_category_is_default(text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- letter_categories policies and guard
-- ---------------------------------------------------------------------------

create policy letter_categories_select_member
  on public.letter_categories
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy letter_categories_select_member on public.letter_categories is
  'Active members read the circle''s custom labels. An outsider and a member who left get nothing.';

create policy letter_categories_insert_member
  on public.letter_categories
  for insert
  to authenticated
  with check (
    private.is_active_member(circle_id)
    and created_by = (select auth.uid())
  );

comment on policy letter_categories_insert_member on public.letter_categories is
  'An active member adds a label as themselves.';

create policy letter_categories_delete_member
  on public.letter_categories
  for delete
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy letter_categories_delete_member on public.letter_categories is
  'An active member can remove a custom label. Letters keep the text they already stored.';

create function private.letter_categories_guard()
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

  new.label := pg_catalog.regexp_replace(
    pg_catalog.btrim(new.label),
    '\s+',
    ' ',
    'g'
  );

  if actor is not null then
    if new.created_by is not null and new.created_by is distinct from actor then
      raise exception 'hsummer_letter_category';
    end if;
    new.created_by := actor;
    new.created_at := pg_catalog.now();

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hsummer-letter-category-rate:' || actor::text,
        0
      )
    );

    select count(*)::integer
      into recent
    from public.letter_categories
    where created_by = actor
      and created_at > pg_catalog.now() - interval '10 minutes';

    if recent >= 10 then
      raise exception 'hsummer_rate_limited';
    end if;
  elsif new.created_by is null then
    raise exception 'hsummer_letter_category';
  end if;

  if private.letter_category_is_default(new.label) then
    raise exception 'hsummer_letter_category';
  end if;

  return new;
end;
$$;

revoke all on function private.letter_categories_guard()
  from public, anon, authenticated;

create trigger letter_categories_guard
  before insert on public.letter_categories
  for each row
  execute function private.letter_categories_guard();

comment on function private.letter_categories_guard() is
  'Stamps the author, rejects a default label, and allows 10 custom categories per 10 minutes.';

-- ---------------------------------------------------------------------------
-- letters
-- ---------------------------------------------------------------------------

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- Null after the sender's account is deleted ("Former member").
  from_user_id uuid references public.profiles (id) on delete set null,
  -- Deleting the recipient removes the letter. Null would look like a
  -- broadcast, and a letter is never a broadcast.
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  title text,
  body text not null,
  design text not null default 'minimal',
  -- Null means deliver now. A timestamp is for week 12. Not granted to
  -- authenticated on insert or update.
  scheduled_for timestamptz,
  -- Week 12 stores the QStash message id here. Not granted to authenticated.
  qstash_message_id text,
  status text not null default 'scheduled',
  delivered_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  constraint letters_category_shape check (
    char_length(category) between 1 and 40
    and position('@' in category) = 0
    and category ~ '^[A-Za-z0-9][A-Za-z0-9 ''-]{0,39}$'
  ),
  constraint letters_title_shape check (
    title is null
    or (
      char_length(title) between 1 and 80
      and position('@' in title) = 0
      and title !~ '[[:cntrl:]]'
    )
  ),
  constraint letters_body_shape check (
    char_length(body) between 1 and 8000
  ),
  constraint letters_design_known check (
    design in ('minimal', 'kawaii', 'retro-film')
  ),
  constraint letters_status_known check (
    status in ('scheduled', 'delivered', 'cancelled')
  ),
  constraint letters_not_self check (
    from_user_id is null or from_user_id is distinct from to_user_id
  ),
  constraint letters_qstash_shape check (
    qstash_message_id is null
    or (
      char_length(qstash_message_id) between 8 and 200
      and qstash_message_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  constraint letters_delivery_shape check (
    (
      status = 'delivered'
      and delivered_at is not null
    )
    or (
      status = 'scheduled'
      and delivered_at is null
      and opened_at is null
    )
    or (
      status = 'cancelled'
      and delivered_at is null
      and opened_at is null
    )
  ),
  constraint letters_opened_shape check (
    opened_at is null
    or (status = 'delivered' and delivered_at is not null)
  )
);

comment on table public.letters is
  'A letter from one member to one other member. The sender can read it. The recipient can read it only after delivered_at is set. Nobody else in the circle can.';

comment on column public.letters.category is
  'A default slug (need-motivation, need-help, feeling-sad, feeling-lonely, distance-is-too-hard, when-we-fight, when-you-miss-me) or a custom label from letter_categories.';

comment on column public.letters.scheduled_for is
  'Null delivers now. A UTC instant is week 12, in the recipient''s local time. Authenticated clients cannot write it yet.';

comment on column public.letters.qstash_message_id is
  'Week 12. Cancel this QStash message when the letter changes or someone leaves. Hidden from authenticated.';

comment on column public.letters.delivered_at is
  'Recipient-visible once this is set. The insert trigger sets it for a letter written now. The client cannot write it.';

comment on column public.letters.opened_at is
  'Set by open_letter. That call also creates the members-only memory.';

create index letters_circle_created_idx
  on public.letters (circle_id, created_at desc);

create index letters_sender_created_idx
  on public.letters (from_user_id, created_at desc);

alter table public.letters enable row level security;

alter table public.letters replica identity full;

revoke all on table public.letters from public, anon, authenticated;

-- qstash_message_id is omitted on purpose.
grant select (
  id,
  circle_id,
  from_user_id,
  to_user_id,
  category,
  title,
  body,
  design,
  scheduled_for,
  status,
  delivered_at,
  opened_at,
  created_at
) on table public.letters to authenticated;

-- Status, delivery, open, schedule, and the QStash id are the trigger's
-- or week 12's. A client cannot deliver, backdate, or schedule from here.
grant insert (
  circle_id,
  from_user_id,
  to_user_id,
  category,
  title,
  body,
  design
) on table public.letters to authenticated;

-- Sender edits or cancels only while the row is still scheduled. The
-- trigger rejects every other change. Delivered rows match no update policy.
grant update (category, title, body, design, status)
  on table public.letters to authenticated;

grant select, insert, update, delete on table public.letters to service_role;

-- ---------------------------------------------------------------------------
-- letters policies
-- ---------------------------------------------------------------------------

create policy letters_select_parties
  on public.letters
  for select
  to authenticated
  using (
    private.is_active_member(circle_id)
    and (
      from_user_id = (select auth.uid())
      or (
        to_user_id = (select auth.uid())
        and delivered_at is not null
      )
    )
  );

comment on policy letters_select_parties on public.letters is
  'The sender, or the recipient once delivered_at is set. An outsider fails is_active_member. A third member fails the party check.';

create policy letters_insert_sender
  on public.letters
  for insert
  to authenticated
  with check (
    from_user_id = (select auth.uid())
    and private.is_active_member(circle_id)
    and to_user_id is distinct from (select auth.uid())
    and private.is_active_member_user(circle_id, to_user_id)
    and opened_at is null
    and scheduled_for is null
    and status = 'delivered'
    and delivered_at is not null
  );

comment on policy letters_insert_sender on public.letters is
  'You write as yourself to another active member. The trigger delivers it now, which is the row this check sees.';

create policy letters_update_sender
  on public.letters
  for update
  to authenticated
  using (
    from_user_id = (select auth.uid())
    and private.is_active_member(circle_id)
    and status = 'scheduled'
    and delivered_at is null
  )
  with check (
    from_user_id = (select auth.uid())
    and private.is_active_member(circle_id)
    and delivered_at is null
    and opened_at is null
    and status in ('scheduled', 'cancelled')
  );

comment on policy letters_update_sender on public.letters is
  'The sender can edit or cancel a letter that has not been delivered. Opening is open_letter, not an update.';

-- ---------------------------------------------------------------------------
-- letters guard
-- ---------------------------------------------------------------------------

create function private.letters_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent integer;
  opening text := pg_catalog.current_setting('hsummer.letter_open', true);
begin
  if new.title is not null then
    new.title := pg_catalog.btrim(new.title);
    if new.title = '' then
      new.title := null;
    end if;
  end if;

  new.body := pg_catalog.btrim(new.body);
  new.category := pg_catalog.btrim(new.category);

  if new.design is null or new.design = '' then
    new.design := 'minimal';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.circle_id is distinct from old.circle_id
       or new.from_user_id is distinct from old.from_user_id
       or new.to_user_id is distinct from old.to_user_id
       or new.created_at is distinct from old.created_at
       or new.scheduled_for is distinct from old.scheduled_for
       or new.qstash_message_id is distinct from old.qstash_message_id
    then
      raise exception 'hsummer_letter_locked';
    end if;

    if opening = '1' then
      if actor is distinct from old.to_user_id
         or old.status is distinct from 'delivered'
         or old.delivered_at is null
         or old.opened_at is not null
         or new.opened_at is null
         or new.status is distinct from old.status
         or new.delivered_at is distinct from old.delivered_at
         or new.body is distinct from old.body
         or new.title is distinct from old.title
         or new.category is distinct from old.category
         or new.design is distinct from old.design
      then
        raise exception 'hsummer_letter_locked';
      end if;
      return new;
    end if;

    if actor is not null then
      if actor is distinct from old.from_user_id
         or old.status is distinct from 'scheduled'
         or old.delivered_at is not null
         or new.delivered_at is not null
         or new.opened_at is not null
         or new.status not in ('scheduled', 'cancelled')
      then
        raise exception 'hsummer_letter_locked';
      end if;
    else
      if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
        raise exception 'hsummer_letter_locked';
      end if;
      if new.status = 'delivered' and new.delivered_at is null then
        new.delivered_at := pg_catalog.now();
      end if;
      if new.status <> 'delivered' then
        new.delivered_at := null;
        new.opened_at := null;
      end if;
    end if;

    if new.status <> 'cancelled'
       and not private.letter_category_known(new.circle_id, new.category)
    then
      raise exception 'hsummer_letter_category';
    end if;

    return new;
  end if;

  if not private.letter_category_known(new.circle_id, new.category) then
    raise exception 'hsummer_letter_category';
  end if;

  if actor is null then
    if new.from_user_id is null then
      raise exception 'hsummer_letter_sender';
    end if;
    if not private.is_active_member_user(new.circle_id, new.from_user_id)
       or not private.is_active_member_user(new.circle_id, new.to_user_id)
       or new.from_user_id = new.to_user_id
    then
      raise exception 'hsummer_letter_recipient';
    end if;
    new.qstash_message_id := null;
    new.opened_at := null;
    if new.scheduled_for is null then
      new.status := 'delivered';
      new.delivered_at := coalesce(new.delivered_at, pg_catalog.now());
    else
      new.status := 'scheduled';
      new.delivered_at := null;
    end if;
    return new;
  end if;

  if new.from_user_id is not null and new.from_user_id is distinct from actor then
    raise exception 'hsummer_letter_sender';
  end if;

  new.from_user_id := actor;
  new.scheduled_for := null;
  new.qstash_message_id := null;
  new.status := 'delivered';
  new.delivered_at := pg_catalog.now();
  new.opened_at := null;
  new.created_at := pg_catalog.now();

  if not private.is_active_member_user(new.circle_id, actor)
     or not private.is_active_member_user(new.circle_id, new.to_user_id)
     or actor = new.to_user_id
  then
    raise exception 'hsummer_letter_recipient';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-letter-rate:' || actor::text, 0)
  );

  select count(*)::integer
    into recent
  from public.letters
  where from_user_id = actor
    and created_at > pg_catalog.now() - interval '10 minutes';

  if recent >= 10 then
    raise exception 'hsummer_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function private.letters_guard()
  from public, anon, authenticated;

create trigger letters_guard
  before insert or update on public.letters
  for each row
  execute function private.letters_guard();

comment on function private.letters_guard() is
  'Delivers a letter written now, refuses a forged sender, and allows 10 letters per 10 minutes. Week 12 may replace this to keep a scheduled row.';

-- ---------------------------------------------------------------------------
-- memories: a letter kind, one row per opened letter
-- ---------------------------------------------------------------------------
--
-- DROP CONSTRAINT replaces the check. It does not delete memories.
-- The new check still accepts every photo and every note.

alter table public.memories
  add column letter_id uuid;

alter table public.memories
  add constraint memories_letter_id_fkey
  foreign key (letter_id) references public.letters (id) on delete cascade;

create unique index memories_one_letter_idx
  on public.memories (letter_id)
  where letter_id is not null;

comment on column public.memories.letter_id is
  'Set only for kind letter. One memory per letter. Cascade-deletes with the letter. Not granted to authenticated on insert.';

comment on column public.memories.kind is
  'photo, note, or letter. A letter has no object. open_letter creates it, visibility selected, for the sender and the recipient only.';

alter table public.memories drop constraint memories_kind_known;

alter table public.memories
  add constraint memories_kind_known
  check (kind in ('photo', 'note', 'letter'));

alter table public.memories drop constraint memories_photo_shape;

alter table public.memories
  add constraint memories_photo_shape
  check (
    (
      kind = 'note'
      and letter_id is null
      and photo_path is null
      and photo_bytes = 0
      and body is not null
    )
    or (
      kind = 'photo'
      and letter_id is null
      and photo_bytes between 1 and 2097152
      and photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and (body is null or char_length(body) <= 280)
    )
    or (
      kind = 'letter'
      and letter_id is not null
      and photo_path is null
      and photo_bytes = 0
      and (body is null or char_length(body) between 1 and 280)
    )
  );

-- Replaces private.memories_guard from week 8. Same photo, note, quota,
-- and rate-limit behavior. Kind letter is allowed only while open_letter
-- has set hsummer.letter_open for this transaction, and the row has to
-- point at a delivered letter between those two people.

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
    end if;
  elsif new.kind = 'note' then
    if new.letter_id is not null then
      raise exception 'hsummer_letter_memory';
    end if;
    new.photo_path := null;
    new.photo_bytes := 0;
  elsif new.kind = 'photo' then
    if new.letter_id is not null then
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
    if new.kind = 'letter' then
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

    if actor is not null then
      if new.id is distinct from old.id
         or new.circle_id is distinct from old.circle_id
         or new.kind is distinct from old.kind
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
         or new.created_by is distinct from old.created_by
         or new.created_at is distinct from old.created_at
         or new.letter_id is distinct from old.letter_id
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

comment on function private.memories_guard() is
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB. A letter memory is created only by open_letter.';

-- Lets a letter's viewer rows leave with the memory, and blocks a direct
-- delete that would hide the card from the recipient while the memory stays.
create function private.memories_mark_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('hsummer.memory_deleting', old.id::text, true);
  return old;
end;
$$;

revoke all on function private.memories_mark_delete()
  from public, anon, authenticated;

create trigger memories_mark_delete
  before delete on public.memories
  for each row
  execute function private.memories_mark_delete();

comment on function private.memories_mark_delete() is
  'Marks the memory id being deleted so its viewer rows can cascade.';

-- Replaces private.memory_viewers_guard from week 8. A letter memory
-- accepts only the recipient, and only during open_letter.
create or replace function private.memory_viewers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_circle uuid;
  found_author uuid;
  found_visibility text;
  found_kind text;
  found_letter uuid;
  recipient uuid;
begin
  select circle_id, created_by, visibility, kind, letter_id
    into found_circle, found_author, found_visibility, found_kind, found_letter
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

  if found_kind = 'letter' then
    if pg_catalog.current_setting('hsummer.letter_open', true) is distinct from '1' then
      raise exception 'hsummer_letter_memory';
    end if;

    select letter.to_user_id
      into recipient
    from public.letters as letter
    where letter.id = found_letter;

    if recipient is null or new.user_id is distinct from recipient then
      raise exception 'hsummer_letter_memory';
    end if;
  end if;

  update public.memories
  set updated_at = pg_catalog.now()
  where id = new.memory_id;

  return new;
end;
$$;

comment on function private.memory_viewers_guard() is
  'Checks the viewer is another active member. A letter memory lists only the recipient, and only while it is being opened.';

create function private.memory_viewers_lock_letter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_kind text;
begin
  select kind
    into found_kind
  from public.memories
  where id = old.memory_id;

  if found_kind = 'letter'
     and pg_catalog.current_setting('hsummer.memory_deleting', true)
       is distinct from old.memory_id::text
  then
    raise exception 'hsummer_letter_memory';
  end if;

  return old;
end;
$$;

revoke all on function private.memory_viewers_lock_letter()
  from public, anon, authenticated;

create trigger memory_viewers_lock_letter
  before delete on public.memory_viewers
  for each row
  execute function private.memory_viewers_lock_letter();

comment on function private.memory_viewers_lock_letter() is
  'Refuses to take the recipient off a letter memory unless the memory itself is going away.';

-- ---------------------------------------------------------------------------
-- Open a delivered letter
-- ---------------------------------------------------------------------------

create function public.open_letter(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  found_id uuid;
  found_circle uuid;
  found_from uuid;
  found_to uuid;
  found_title text;
  found_status text;
  found_delivered timestamptz;
  found_opened timestamptz;
  filed_memory uuid;
  zone text;
  filed date;
begin
  if actor is null or target is null then
    raise exception 'hsummer_letter_open';
  end if;

  select
    letter.id,
    letter.circle_id,
    letter.from_user_id,
    letter.to_user_id,
    letter.title,
    letter.status,
    letter.delivered_at,
    letter.opened_at
    into
      found_id,
      found_circle,
      found_from,
      found_to,
      found_title,
      found_status,
      found_delivered,
      found_opened
  from public.letters as letter
  where letter.id = target
  for update;

  if not found
     or found_to is distinct from actor
     or found_status is distinct from 'delivered'
     or found_delivered is null
     or not private.is_active_member(found_circle)
  then
    raise exception 'hsummer_letter_open';
  end if;

  perform pg_catalog.set_config('hsummer.letter_open', '1', true);

  if found_opened is null then
    update public.letters
    set opened_at = pg_catalog.now()
    where id = found_id;
  end if;

  select memory.id
    into filed_memory
  from public.memories as memory
  where memory.letter_id = found_id;

  if filed_memory is null then
    select profile.timezone
      into zone
    from public.profiles as profile
    where profile.id = actor;

    if zone is null or zone !~ '^[A-Za-z0-9_+/-]{1,64}$' then
      zone := 'UTC';
    end if;

    begin
      filed := (pg_catalog.timezone(zone, pg_catalog.now()))::date;
    exception
      when invalid_parameter_value then
        filed := (pg_catalog.timezone('UTC', pg_catalog.now()))::date;
    end;

    filed_memory := pg_catalog.gen_random_uuid();

    begin
      insert into public.memories (
        id,
        circle_id,
        created_by,
        kind,
        body,
        photo_path,
        photo_bytes,
        tags,
        visibility,
        occurred_on,
        letter_id
      )
      values (
        filed_memory,
        found_circle,
        found_from,
        'letter',
        pg_catalog.left(
          coalesce(nullif(pg_catalog.btrim(found_title), ''), 'A letter'),
          280
        ),
        null,
        0,
        array['letter']::text[],
        'selected',
        filed,
        found_id
      );
    exception
      when unique_violation then
        select memory.id
          into filed_memory
        from public.memories as memory
        where memory.letter_id = found_id;
    end;

    if filed_memory is not null
       and found_from is distinct from actor
       and not exists (
         select 1
         from public.memory_viewers as viewer
         where viewer.memory_id = filed_memory
           and viewer.user_id = actor
       )
    then
      insert into public.memory_viewers (memory_id, circle_id, user_id)
      values (filed_memory, found_circle, actor);
    end if;
  end if;

  perform pg_catalog.set_config('hsummer.letter_open', '', true);

  if filed_memory is null then
    raise exception 'hsummer_letter_open';
  end if;

  return filed_memory;
end;
$$;

revoke all on function public.open_letter(uuid)
  from public, anon, authenticated;

grant execute on function public.open_letter(uuid) to authenticated;

comment on function public.open_letter(uuid) is
  'The recipient opens a delivered letter once. Sets opened_at and creates one selected memory for the sender and the recipient. The body is not copied onto the memory.';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Hosted Supabase already has the supabase_realtime publication. Adding
-- the tables here is the same switch as the dashboard toggle. If that
-- publication does not exist yet, skip; enable Realtime for letters and
-- letter_categories in the dashboard after this file has run.

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
      and tablename = 'letters'
  ) then
    alter publication supabase_realtime add table public.letters;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'letter_categories'
  ) then
    alter publication supabase_realtime add table public.letter_categories;
  end if;
end
$$;
