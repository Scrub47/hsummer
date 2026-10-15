-- Weeks 16–18 launch readiness.
--
-- Additive on top of 20270118120000_pass_the_booth.sql.
-- Safe to run once against a database that already has weeks 1–15.
-- Do not edit or re-run those files.
--
-- This adds:
--   * leave_circle: end access, cancel undelivered letters, cancel open
--     booth sessions, and optionally remove this person's contributions
--   * delete_own_account: leave every circle, delete the login, the profile,
--     push subscriptions, moods, pings, and avatar files. Shared rows that
--     stay show as Former member (author columns become null)
--   * a 30-day grace period for a circle with nobody left, then purge
--   * one seeded demo couple. Uploads, pushes, invites, and edits are refused
--   * a private exports bucket for a personal ZIP that is too large to return
--     in one response
--   * a daily sweep for quiet circles (pass expiry, orphan booth files,
--     auto checkpoints)
--
-- The Supabase editor may warn that some statements look destructive.
-- What each one actually does:
--
--   * DROP CONSTRAINT letters_to_user_id_fkey, then ADD it again with
--     ON DELETE SET NULL. The old rule deleted the sender's letter when the
--     recipient's account was deleted. The new rule keeps that letter and
--     clears the recipient. A null recipient is not a broadcast: the letter
--     read policy never treats null as "everyone." No letter row is deleted
--     by this statement.
--   * ALTER COLUMN letters.to_user_id DROP NOT NULL. Required so that SET NULL
--     is legal. No row is deleted.
--   * DROP CONSTRAINT booth_shots_contributor_fkey. That foreign key deleted
--     every frame when the contributor row went away, which would erase a
--     strip the keep option is supposed to leave up. No shot row is deleted
--     by the drop.
--   * DROP CONSTRAINT booth_shots_user_id_fkey and DROP NOT NULL on
--     booth_shots.user_id, then ADD the foreign key with ON DELETE SET NULL.
--     A kept frame stays in the circle after the account is gone. The drop
--     does not delete shots.
--   * CREATE OR REPLACE FUNCTION replaces refresh_circle_status,
--     circles_guard_update, profiles_guard_update, and security_audit_gaps.
--     The triggers that call them stay in place. No rows are deleted.
--   * DELETE statements live inside leave_circle, delete_own_account,
--     purge_archived_circles, and seed_demo_circle. They do not run when
--     this file is applied. Their scope is described on each function.
--
-- delete_own_account disables six BEFORE UPDATE guards only for the
-- auth.users delete, so ON DELETE SET NULL can clear author columns those
-- guards normally lock. It enables the guards again before it returns.
-- A failed delete rolls the whole transaction back, including the disable.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.circles
  add column archived_at timestamptz;

alter table public.circles
  add column is_demo boolean not null default false;

comment on column public.circles.archived_at is
  'Set when the circle first reaches zero active members. Cleared if someone rejoins. purge_archived_circles deletes the circle 30 days later.';

comment on column public.circles.is_demo is
  'The one seeded couple for portfolio review. Real accounts cannot join it. Writes are refused.';

create unique index circles_one_demo_idx
  on public.circles (is_demo)
  where is_demo;

create index circles_archived_at_idx
  on public.circles (archived_at)
  where status = 'archived';

alter table public.account_private
  add column is_demo boolean not null default false;

comment on column public.account_private.is_demo is
  'True for the two seeded demo accounts. Not granted for update. Owner can read it. It is not copied to profiles.';

-- ---------------------------------------------------------------------------
-- Letters stay when the recipient's account is deleted
-- ---------------------------------------------------------------------------

alter table public.letters
  drop constraint letters_to_user_id_fkey;

alter table public.letters
  alter column to_user_id drop not null;

alter table public.letters
  add constraint letters_to_user_id_fkey
  foreign key (to_user_id) references public.profiles (id) on delete set null;

comment on column public.letters.to_user_id is
  'The one recipient. Null after that account is deleted (Former member). Null is not a broadcast.';

-- ---------------------------------------------------------------------------
-- Kept booth frames survive the contributor's account
-- ---------------------------------------------------------------------------

alter table public.booth_shots
  drop constraint booth_shots_contributor_fkey;

alter table public.booth_shots
  drop constraint booth_shots_user_id_fkey;

alter table public.booth_shots
  alter column user_id drop not null;

alter table public.booth_shots
  add constraint booth_shots_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

comment on column public.booth_shots.user_id is
  'Who took the frame. Null after that account is deleted and the frame was kept.';

-- ---------------------------------------------------------------------------
-- Private export bucket. No client policy. The server uploads with the
-- secret key and returns a short-lived signed URL. The ZIP itself holds the
-- real image bytes, so the link is only how you download the archive.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  209715200,
  array['application/zip']
);

comment on table public.circles is
  'A private space for two or more people. Pending until a second person joins. Archived when nobody is left. One row is the seeded demo.';

-- ---------------------------------------------------------------------------
-- Status, including the archive clock
-- ---------------------------------------------------------------------------

create or replace function private.refresh_circle_status(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
  next_status text;
begin
  select count(*)::integer
    into active_count
  from public.circle_members
  where circle_id = target
    and left_at is null;

  next_status := case
    when active_count = 0 then 'archived'
    when active_count = 1 then 'pending'
    else 'active'
  end;

  perform pg_catalog.set_config('hsummer.allow_status', '1', true);

  update public.circles
  set
    status = next_status,
    archived_at = case
      when next_status = 'archived' then coalesce(archived_at, pg_catalog.now())
      else null
    end
  where id = target
    and (
      status is distinct from next_status
      or (next_status = 'archived' and archived_at is null)
      or (next_status is distinct from 'archived' and archived_at is not null)
    );
end;
$$;

create or replace function private.circles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.circle_type is distinct from old.circle_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'circle identity cannot change';
  end if;

  if new.is_demo is distinct from old.is_demo
     and pg_catalog.current_setting('hsummer.demo_seed', true) is distinct from '1' then
    raise exception 'hsummer_demo_readonly';
  end if;

  if new.status is distinct from old.status
     and pg_catalog.current_setting('hsummer.allow_status', true)
       is distinct from '1' then
    raise exception 'circle status is maintained by membership';
  end if;

  if new.name is not null and (
    pg_catalog.char_length(pg_catalog.btrim(new.name)) = 0
    or pg_catalog.char_length(new.name) > 80
    or pg_catalog.strpos(new.name, '@') > 0
  ) then
    raise exception 'hsummer_bad_name';
  end if;

  return new;
end;
$$;

create or replace function private.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    return new;
  end if;

  if exists (
    select 1
    from public.account_private as account
    where account.user_id = old.id
      and account.is_demo
  ) then
    raise exception 'hsummer_demo_readonly';
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'profile id and created_at cannot change';
  end if;

  if new.avatar_path is not distinct from old.avatar_path then
    return new;
  end if;

  if new.avatar_path is null then
    return new;
  end if;

  if new.avatar_path ~ (
    '^'
    || old.id::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    return new;
  end if;

  raise exception 'avatar_path must be empty or a file in your avatars folder';
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo isolation and the couple-after-a-breakup invite rule
-- ---------------------------------------------------------------------------

create function private.circle_is_demo(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circles as circle
    where circle.id = target
      and circle.is_demo
  );
$$;

revoke all on function private.circle_is_demo(uuid)
  from public, anon, authenticated;

create function private.reject_demo_circle_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    target := old.circle_id;
  else
    target := new.circle_id;
  end if;

  if private.circle_is_demo(target) then
    raise exception 'hsummer_demo_readonly';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_demo_circle_write()
  from public, anon, authenticated;

create trigger memories_reject_demo
  before insert or update or delete on public.memories
  for each row
  execute function private.reject_demo_circle_write();

create trigger letters_reject_demo
  before insert or update or delete on public.letters
  for each row
  execute function private.reject_demo_circle_write();

create trigger letter_categories_reject_demo
  before insert or update or delete on public.letter_categories
  for each row
  execute function private.reject_demo_circle_write();

create trigger bucket_items_reject_demo
  before insert or update or delete on public.bucket_items
  for each row
  execute function private.reject_demo_circle_write();

create trigger countdowns_reject_demo
  before insert or update or delete on public.countdowns
  for each row
  execute function private.reject_demo_circle_write();

create trigger checkpoints_reject_demo
  before insert or update or delete on public.checkpoints
  for each row
  execute function private.reject_demo_circle_write();

create trigger current_moods_reject_demo
  before insert or update or delete on public.current_moods
  for each row
  execute function private.reject_demo_circle_write();

create trigger pings_reject_demo
  before insert or update or delete on public.pings
  for each row
  execute function private.reject_demo_circle_write();

create trigger booth_sessions_reject_demo
  before insert or update or delete on public.booth_sessions
  for each row
  execute function private.reject_demo_circle_write();

create trigger circle_invites_reject_demo
  before insert or update or delete on public.circle_invites
  for each row
  execute function private.reject_demo_circle_write();

create function private.reject_demo_session_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_key uuid;
  target uuid;
begin
  if pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    session_key := old.session_id;
  else
    session_key := new.session_id;
  end if;

  select session.circle_id
    into target
  from public.booth_sessions as session
  where session.id = session_key;

  if private.circle_is_demo(target) then
    raise exception 'hsummer_demo_readonly';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.reject_demo_session_write()
  from public, anon, authenticated;

create trigger booth_contributors_reject_demo
  before insert or update or delete on public.booth_contributors
  for each row
  execute function private.reject_demo_session_write();

create trigger booth_shots_reject_demo
  before insert or update or delete on public.booth_shots
  for each row
  execute function private.reject_demo_session_write();

create function private.circle_members_demo_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_demo boolean;
  circle_demo boolean;
begin
  if pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select account.is_demo
    into user_demo
  from public.account_private as account
  where account.user_id = new.user_id;

  select circle.is_demo
    into circle_demo
  from public.circles as circle
  where circle.id = new.circle_id;

  if tg_op = 'INSERT' and (coalesce(user_demo, false) or coalesce(circle_demo, false)) then
    raise exception 'hsummer_demo_closed';
  end if;

  if tg_op = 'UPDATE'
     and new.left_at is not null
     and old.left_at is null
     and coalesce(user_demo, false) then
    raise exception 'hsummer_demo_readonly';
  end if;

  return new;
end;
$$;

revoke all on function private.circle_members_demo_guard()
  from public, anon, authenticated;

create trigger circle_members_demo_guard
  before insert or update on public.circle_members
  for each row
  execute function private.circle_members_demo_guard();

comment on function private.circle_members_demo_guard() is
  'Demo accounts stay in the demo circle only. A real account cannot join it, and a demo account cannot join a real circle or leave.';

create function private.circle_invites_couple_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_type text;
  someone_left boolean;
  active_count integer;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    return new;
  end if;

  select circle.circle_type
    into found_type
  from public.circles as circle
  where circle.id = new.circle_id;

  if found_type is distinct from 'couple' then
    return new;
  end if;

  select
    exists (
      select 1
      from public.circle_members as member
      where member.circle_id = new.circle_id
        and member.left_at is not null
    ),
    count(*) filter (where member.left_at is null)::integer
    into someone_left, active_count
  from public.circle_members as member
  where member.circle_id = new.circle_id;

  if someone_left and active_count < 2 then
    raise exception 'hsummer_couple_closed';
  end if;

  return new;
end;
$$;

revoke all on function private.circle_invites_couple_closed()
  from public, anon, authenticated;

create trigger circle_invites_couple_closed
  before insert on public.circle_invites
  for each row
  execute function private.circle_invites_couple_closed();

comment on function private.circle_invites_couple_closed() is
  'A couple that has dropped to one member cannot mint a new invite. A brand-new pending couple still can.';

create function private.push_block_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.account_private as account
    where account.user_id = new.user_id
      and account.is_demo
  ) then
    raise exception 'hsummer_demo_readonly';
  end if;
  return new;
end;
$$;

revoke all on function private.push_block_demo()
  from public, anon, authenticated;

create trigger push_subscriptions_block_demo
  before insert or update on public.push_subscriptions
  for each row
  execute function private.push_block_demo();

create function private.storage_block_demo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder text;
  owner_id uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- The nightly reset uploads with the secret key, which has no auth.uid().
  -- A signed-in session, including the demo account, still cannot upload.
  if (select auth.uid()) is null
     or pg_catalog.current_setting('hsummer.demo_seed', true) = '1' then
    return new;
  end if;

  folder := (storage.foldername(new.name))[1];
  owner_id := private.uuid_or_null(folder);

  if new.bucket_id = 'avatars' and exists (
    select 1
    from public.account_private as account
    where account.user_id = owner_id
      and account.is_demo
  ) then
    raise exception 'hsummer_demo_readonly';
  end if;

  if new.bucket_id = 'memories' and private.circle_is_demo(owner_id) then
    raise exception 'hsummer_demo_readonly';
  end if;

  return new;
end;
$$;

revoke all on function private.storage_block_demo()
  from public, anon, authenticated;

create trigger storage_objects_block_demo
  before insert or update on storage.objects
  for each row
  execute function private.storage_block_demo();

comment on function private.storage_block_demo() is
  'Refuses a new avatar for a demo account and a new file in the demo circle. Deletes still run so a reset can replace the files.';

-- ---------------------------------------------------------------------------
-- Act as a member inside a security-definer seed or sweep.
-- auth.uid() reads these settings. Cleared at the end of the caller.
-- ---------------------------------------------------------------------------

create function private.act_as(actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor is null then
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform pg_catalog.set_config('request.jwt.claims', '', true);
    return;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', actor::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', actor)::text,
    true
  );
end;
$$;

revoke all on function private.act_as(uuid) from public, anon, authenticated;

create function private.set_author_guards(enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if enabled then
    alter table public.letters enable trigger letters_guard;
    alter table public.memories enable trigger memories_guard;
    alter table public.circles enable trigger circles_guard_update;
    alter table public.bucket_items enable trigger bucket_items_guard;
    alter table public.countdowns enable trigger countdowns_guard;
    alter table public.checkpoints enable trigger checkpoints_guard;
  else
    alter table public.letters disable trigger letters_guard;
    alter table public.memories disable trigger memories_guard;
    alter table public.circles disable trigger circles_guard_update;
    alter table public.bucket_items disable trigger bucket_items_guard;
    alter table public.countdowns disable trigger countdowns_guard;
    alter table public.checkpoints disable trigger checkpoints_guard;
  end if;
end;
$$;

revoke all on function private.set_author_guards(boolean)
  from public, anon, authenticated;

comment on function private.set_author_guards(boolean) is
  'Turns six author-lock triggers off or on. delete_own_account uses this only around the login delete, then turns them back on. The change is part of that transaction.';

-- ---------------------------------------------------------------------------
-- Remove one person's contributions in one circle.
-- Photos, notes, sent letters, and that person's booth frames.
-- A strip with no frames left is deleted. A strip that still has someone
-- else's frames stays, with an empty slot where the removed frames were.
-- Bucket items, countdowns, and checkpoints stay.
-- ---------------------------------------------------------------------------

create function private.remove_circle_contributions(actor uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.letters as letter
  where letter.circle_id = target
    and letter.from_user_id = actor;

  delete from public.memories as memory
  where memory.circle_id = target
    and memory.created_by = actor
    and memory.kind in ('photo', 'note');

  delete from public.booth_shots as shot
  using public.booth_sessions as session
  where shot.session_id = session.id
    and session.circle_id = target
    and shot.user_id = actor;

  delete from public.memories as memory
  where memory.circle_id = target
    and memory.kind = 'photo-strip'
    and memory.booth_session_id is not null
    and not exists (
      select 1
      from public.booth_shots as shot
      where shot.session_id = memory.booth_session_id
    );

  delete from public.booth_sessions as session
  where session.circle_id = target
    and session.status in ('open', 'ready', 'capturing', 'cancelled')
    and not exists (
      select 1
      from public.booth_shots as shot
      where shot.session_id = session.id
    )
    and (
      session.created_by = actor
      or exists (
        select 1
        from public.booth_contributors as contributor
        where contributor.session_id = session.id
          and contributor.user_id = actor
      )
    );
end;
$$;

revoke all on function private.remove_circle_contributions(uuid, uuid)
  from public, anon, authenticated;

comment on function private.remove_circle_contributions(uuid, uuid) is
  'Deletes this person''s photos, notes, sent letters, and booth frames in one circle, plus the storage objects those row triggers remove. Shared plans stay.';

create function private.cancel_open_work(actor uuid, target uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select letter.qstash_message_id
  from public.letters as letter
  where letter.circle_id = target
    and letter.status = 'scheduled'
    and letter.qstash_message_id is not null
    and (
      letter.from_user_id = actor
      or letter.to_user_id = actor
    );

  perform private.set_author_guards(false);

  update public.letters as letter
  set
    status = 'cancelled',
    delivered_at = null,
    opened_at = null,
    qstash_message_id = null
  where letter.circle_id = target
    and letter.status = 'scheduled'
    and (
      letter.from_user_id = actor
      or letter.to_user_id = actor
    );

  perform private.set_author_guards(true);

  update public.booth_sessions as session
  set status = 'cancelled'
  where session.circle_id = target
    and session.status in ('open', 'ready', 'capturing')
    and exists (
      select 1
      from public.booth_contributors as contributor
      where contributor.session_id = session.id
        and contributor.user_id = actor
    );
end;
$$;

revoke all on function private.cancel_open_work(uuid, uuid)
  from public, anon, authenticated;

comment on function private.cancel_open_work(uuid, uuid) is
  'Cancels undelivered letters to or from this person and open booth sessions they are in. Returns QStash ids for the app to cancel. The letter rows stay unless remove-my-content deleted the ones they sent.';

create function private.depart_circle(
  actor uuid,
  target uuid,
  remove_content boolean,
  require_active boolean
)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_type text;
  active_left integer;
begin
  if actor is null or target is null then
    raise exception 'hsummer_not_member';
  end if;

  if not exists (
    select 1
    from public.circle_members as member
    where member.circle_id = target
      and member.user_id = actor
  ) then
    if require_active then
      raise exception 'hsummer_not_member';
    end if;
    return;
  end if;

  if require_active and not exists (
    select 1
    from public.circle_members as member
    where member.circle_id = target
      and member.user_id = actor
      and member.left_at is null
  ) then
    raise exception 'hsummer_not_member';
  end if;

  if coalesce(remove_content, false) then
    perform private.remove_circle_contributions(actor, target);
  end if;

  if exists (
    select 1
    from public.circle_members as member
    where member.circle_id = target
      and member.user_id = actor
      and member.left_at is null
  ) then
    return query
    select cancelled.message_id
    from private.cancel_open_work(actor, target) as cancelled(message_id);

    update public.circle_members as member
    set left_at = pg_catalog.now()
    where member.circle_id = target
      and member.user_id = actor
      and member.left_at is null;

    select circle.circle_type
      into found_type
    from public.circles as circle
    where circle.id = target;

    select count(*)::integer
      into active_left
    from public.circle_members as member
    where member.circle_id = target
      and member.left_at is null;

    if found_type = 'couple'
       and active_left < 2
       and exists (
         select 1
         from public.circle_members as member
         where member.circle_id = target
           and member.left_at is not null
       ) then
      update public.circle_invites as invite
      set revoked_at = pg_catalog.now()
      where invite.circle_id = target
        and invite.revoked_at is null;
    end if;
  elsif coalesce(remove_content, false) then
    return query
    select cancelled.message_id
    from private.cancel_open_work(actor, target) as cancelled(message_id);
  end if;
end;
$$;

revoke all on function private.depart_circle(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;

comment on function private.depart_circle(uuid, uuid, boolean, boolean) is
  'Leaves one circle or, when require_active is false, only removes content from a circle already left. Sets left_at. Does not delete the login.';

create function private.assert_real_account(actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor is null then
    raise exception 'hsummer_unauthenticated';
  end if;

  if exists (
    select 1
    from public.account_private as account
    where account.user_id = actor
      and account.is_demo
  ) then
    raise exception 'hsummer_demo_readonly';
  end if;
end;
$$;

revoke all on function private.assert_real_account(uuid)
  from public, anon, authenticated;

create function public.leave_circle(target_circle uuid, remove_content boolean)
returns table (message_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  perform private.assert_real_account(actor);

  return query
  select departed.message_id
  from private.depart_circle(
    actor,
    target_circle,
    coalesce(remove_content, false),
    true
  ) as departed(message_id);
end;
$$;

revoke all on function public.leave_circle(uuid, boolean)
  from public, anon;

grant execute on function public.leave_circle(uuid, boolean) to authenticated;

comment on function public.leave_circle(uuid, boolean) is
  'The signed-in person leaves one circle. remove_content false keeps their photos, notes, and letters. true deletes those contributions in this circle only. Scheduled letters are cancelled either way. Returns QStash message ids.';

create function public.delete_own_account(remove_content boolean)
returns table (message_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  membership record;
begin
  perform private.assert_real_account(actor);

  for membership in
    select member.circle_id
    from public.circle_members as member
    where member.user_id = actor
  loop
    return query
    select departed.message_id
    from private.depart_circle(
      actor,
      membership.circle_id,
      coalesce(remove_content, false),
      false
    ) as departed(message_id);
  end loop;

  delete from public.pings as ping
  where ping.from_user_id = actor
     or ping.to_user_id = actor;

  delete from public.current_moods as mood
  where mood.user_id = actor;

  delete from public.push_subscriptions as device
  where device.user_id = actor;

  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects as object
  where object.bucket_id = 'avatars'
    and (storage.foldername(object.name))[1] = actor::text;

  perform private.set_author_guards(false);

  delete from auth.users as account
  where account.id = actor;

  perform private.set_author_guards(true);
exception
  when others then
    perform private.set_author_guards(true);
    raise;
end;
$$;

revoke all on function public.delete_own_account(boolean)
  from public, anon;

grant execute on function public.delete_own_account(boolean) to authenticated;

comment on function public.delete_own_account(boolean) is
  'Deletes the signed-in login. Leaves every circle first. Always removes the profile, email, avatar files, push subscriptions, moods, and pings. remove_content false keeps shared contributions under Former member. true deletes this person''s photos, notes, sent letters, and booth frames in every circle they were in.';

-- ---------------------------------------------------------------------------
-- Archived circles, quiet circles, demo reset
-- ---------------------------------------------------------------------------

create function public.purge_archived_circles()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer := 0;
begin
  if (select auth.uid()) is not null then
    raise exception 'hsummer_not_member';
  end if;

  delete from public.circles as circle
  where circle.status = 'archived'
    and circle.is_demo = false
    and circle.archived_at is not null
    and circle.archived_at < pg_catalog.now() - interval '30 days';

  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function public.purge_archived_circles()
  from public, anon, authenticated;

grant execute on function public.purge_archived_circles() to service_role;

comment on function public.purge_archived_circles() is
  'Deletes circles that have had zero members for 30 days, and the rows and files that cascade from them. Skips the demo circle. service_role only. A signed-in call is refused.';

create function public.sweep_quiet_circles()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  target uuid;
  local_day date;
  best_member uuid;
  best_day date;
  closed_count integer := 0;
  one_closed integer;
begin
  if (select auth.uid()) is not null then
    raise exception 'hsummer_not_member';
  end if;

  with closed as (
    update public.booth_sessions as session
    set status = 'expired'
    where session.mode = 'pass'
      and session.status = 'open'
      and session.expires_at is not null
      and session.expires_at <= pg_catalog.now()
      and not private.circle_is_demo(session.circle_id)
    returning session.id
  )
  select count(*)::integer
    into one_closed
  from closed;

  closed_count := coalesce(one_closed, 0);

  delete from public.booth_shots as shot
  using public.booth_sessions as session
  where shot.session_id = session.id
    and session.mode = 'pass'
    and session.status in ('expired', 'cancelled')
    and not private.circle_is_demo(session.circle_id);

  perform pg_catalog.set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects as object
  where object.bucket_id = 'memories'
    and object.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-3]\.jpg$'
    and object.created_at < pg_catalog.now() - interval '24 hours'
    and not exists (
      select 1
      from public.booth_shots as shot
      where shot.storage_path = object.name
    );

  for target in
    select circle.id
    from public.circles as circle
    where circle.is_demo = false
      and circle.status <> 'archived'
  loop
    best_member := null;
    best_day := null;

    for actor in
      select member.user_id
      from public.circle_members as member
      where member.circle_id = target
        and member.left_at is null
    loop
      local_day := private.viewer_local_date(actor);
      if best_day is null or local_day > best_day then
        best_day := local_day;
        best_member := actor;
      end if;
    end loop;

    if best_member is not null then
      perform private.act_as(best_member);
      perform synced.memory_id
      from public.sync_auto_checkpoints(target) as synced;
    end if;
  end loop;

  perform private.act_as(null);
  return closed_count;
end;
$$;

revoke all on function public.sweep_quiet_circles()
  from public, anon, authenticated;

grant execute on function public.sweep_quiet_circles() to service_role;

comment on function public.sweep_quiet_circles() is
  'Daily job for circles nobody opened. Expires passes, deletes orphan booth files older than 24 hours, and runs the same auto-checkpoint sync the app runs on load, using the latest local date among active members. Skips the demo circle. service_role only.';

-- Fixed ids. The app creates the auth users with these ids before calling
-- seed_demo_circle. Nothing else is allowed to use them.
-- Alex is the account a reviewer signs into. Jordan is the other person.

create function public.seed_demo_circle(photo_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alex uuid := 'a11ce000-0000-4000-8000-0000000000a1';
  jordan uuid := 'a11ce000-0000-4000-8000-0000000000b2';
  demo_circle uuid := 'a11ce000-0000-4000-8000-0000000000c3';
  photo_memory uuid := 'a11ce000-0000-4000-8000-0000000000d4';
  demo_letter uuid := 'a11ce000-0000-4000-8000-0000000000e5';
  photo_path text;
  booth jsonb;
  booth_paths jsonb;
begin
  if (select auth.uid()) is not null then
    raise exception 'hsummer_not_member';
  end if;

  if photo_bytes is null or photo_bytes < 1 or photo_bytes > 2097152 then
    raise exception 'hsummer_demo_readonly';
  end if;

  if not exists (select 1 from public.profiles where id = alex)
     or not exists (select 1 from public.profiles where id = jordan) then
    raise exception 'hsummer_demo_readonly';
  end if;

  perform pg_catalog.set_config('hsummer.demo_seed', '1', true);

  update public.account_private as account
  set
    is_demo = true,
    age_confirmed_at = coalesce(account.age_confirmed_at, pg_catalog.now())
  where account.user_id in (alex, jordan);

  update public.profiles as profile
  set
    display_name = case
      when profile.id = alex then 'Alex'
      else 'Jordan'
    end,
    timezone = case
      when profile.id = alex then 'America/Los_Angeles'
      else 'America/New_York'
    end,
    avatar_path = null
  where profile.id in (alex, jordan);

  if not exists (select 1 from public.circles where id = demo_circle) then
    insert into public.circles (id, name, circle_type, created_by, status, is_demo)
    values (demo_circle, 'Alex & Jordan', 'couple', alex, 'pending', true);
  else
    update public.circles as circle
    set
      name = 'Alex & Jordan',
      is_demo = true
    where circle.id = demo_circle;
  end if;

  insert into public.circle_members (circle_id, user_id)
  values (demo_circle, alex), (demo_circle, jordan)
  on conflict (circle_id, user_id) do nothing;

  perform pg_catalog.set_config('hsummer.allow_rejoin', '1', true);

  update public.circle_members as member
  set left_at = null
  where member.circle_id = demo_circle
    and member.user_id in (alex, jordan);

  delete from public.memories as memory
  where memory.circle_id = demo_circle;

  delete from public.booth_sessions as session
  where session.circle_id = demo_circle;

  delete from public.letters as letter
  where letter.circle_id = demo_circle;

  delete from public.pings as ping
  where ping.circle_id = demo_circle;

  delete from public.current_moods as mood
  where mood.circle_id = demo_circle;

  delete from public.bucket_items as item
  where item.circle_id = demo_circle;

  delete from public.checkpoints as checkpoint
  where checkpoint.circle_id = demo_circle;

  delete from public.circle_invites as invite
  where invite.circle_id = demo_circle;

  perform private.act_as(alex);

  update public.countdowns as countdown
  set target_date = date '2027-06-12'
  where countdown.circle_id = demo_circle;

  insert into public.checkpoints (
    circle_id,
    countdown_id,
    label,
    date,
    trigger
  )
  select
    demo_circle,
    countdown.id,
    'Booked the visit',
    date '2027-03-01',
    'manual'
  from public.countdowns as countdown
  where countdown.circle_id = demo_circle
  limit 1;

  insert into public.bucket_items (
    circle_id,
    title,
    category,
    status,
    notes
  )
  values (
    demo_circle,
    'Try the ramen shop on Pine',
    'restaurant',
    'idea',
    'A fictional plan for the demo. Not a real reservation.'
  );

  insert into public.current_moods (user_id, circle_id, emoji)
  values (alex, demo_circle, '😊');

  photo_path := demo_circle::text || '/' || photo_memory::text || '.jpg';

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
    occurred_on
  )
  values (
    photo_memory,
    demo_circle,
    alex,
    'photo',
    'Kitchen light',
    photo_path,
    photo_bytes,
    array['home']::text[],
    'circle',
    current_date
  );

  insert into public.memories (
    circle_id,
    created_by,
    kind,
    body,
    tags,
    visibility,
    occurred_on
  )
  values (
    demo_circle,
    alex,
    'note',
    'First week in the new city. The light in the kitchen is nice.',
    array['week-one']::text[],
    'circle',
    current_date
  );

  insert into public.letters (
    id,
    circle_id,
    from_user_id,
    to_user_id,
    category,
    title,
    body,
    design
  )
  values (
    demo_letter,
    demo_circle,
    alex,
    jordan,
    'when-you-miss-me',
    'For a long week',
    'The train was late and I thought of you. This letter is fictional, for the demo circle only.',
    'minimal'
  );

  insert into public.pings (circle_id, from_user_id, to_user_id, ping_type)
  values (demo_circle, alex, jordan, 'thinking-of-you');

  booth := public.save_solo_booth(
    demo_circle,
    'kawaii',
    '2-cut',
    'none',
    'A made-up strip',
    array[photo_bytes, photo_bytes]
  );

  perform private.act_as(jordan);

  insert into public.current_moods (user_id, circle_id, emoji)
  values (jordan, demo_circle, '😌');

  perform public.open_letter(demo_letter);

  perform private.act_as(null);
  perform pg_catalog.set_config('hsummer.demo_seed', '', true);

  booth_paths := coalesce(booth -> 'paths', '[]'::jsonb);

  return pg_catalog.jsonb_build_object(
    'circleId', demo_circle,
    'photoPath', photo_path,
    'boothPaths', booth_paths
  );
exception
  when others then
    perform private.act_as(null);
    perform pg_catalog.set_config('hsummer.demo_seed', '', true);
    raise;
end;
$$;

revoke all on function public.seed_demo_circle(integer)
  from public, anon, authenticated;

grant execute on function public.seed_demo_circle(integer) to service_role;

comment on function public.seed_demo_circle(integer) is
  'Rebuilds the one demo couple from fictional rows. Deletes only that circle''s content. service_role only. The two auth users must already exist at the fixed ids.';

-- ---------------------------------------------------------------------------
-- Catalog: a public exports bucket is a gap, same as the other buckets
-- ---------------------------------------------------------------------------

create or replace function public.security_audit_gaps()
returns table (kind text, object_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'rls'::text, n.nspname || '.' || c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind = 'r'
    and c.relrowsecurity = false
  union all
  select 'storage_rls'::text, n.nspname || '.' || c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage'
    and c.relname = 'objects'
    and c.relkind = 'r'
    and c.relrowsecurity = false
  union all
  select 'public_bucket'::text, b.id
  from storage.buckets b
  where b.public is true
    and b.id in ('avatars', 'memories', 'backups', 'exports')
  union all
  select 'public_view'::text, n.nspname || '.' || c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
  union all
  select 'anon_grant'::text,
    grants.table_schema || '.' || grants.table_name || ' ' || grants.privilege_type
  from information_schema.role_table_grants as grants
  where grants.grantee = 'anon'
    and grants.table_schema = 'public';
$$;

comment on function public.security_audit_gaps() is
  'Rows mean a gap: missing RLS, a public avatars/memories/backups/exports bucket, a public view, or an anon table grant. Empty is the passing result. service_role only.';
