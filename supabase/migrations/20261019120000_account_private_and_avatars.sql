-- Week 2 profiles.
--
-- Additive on top of 20261012120000_profiles_and_push_subscriptions.sql.
-- Safe to run once against a database that already has that migration.
-- Do not edit or re-run the week 1 file.
--
-- This adds:
--   * account_private — owner-only settings. Email is not a column.
--   * private.can_read_profile — owner-only today. Week 3 adds the
--     "shares an active circle" clause here, not in every policy.
--   * a private Storage bucket, avatars, served with signed URLs.
--
-- Signup still goes through handle_new_user. The function body grows an
-- insert into account_private. It still does not read new.email.

-- ---------------------------------------------------------------------------
-- account_private
-- ---------------------------------------------------------------------------
--
-- Age confirmation and notification preferences live here, never on profiles.
-- Circle members must not gain a policy on this table in week 3.

create table public.account_private (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Null until the person confirms they are 13+. The launch-readiness week
  -- sets this. Do not copy it onto profiles.
  age_confirmed_at timestamptz,
  notification_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_private_prefs_object check (
    jsonb_typeof(notification_prefs) = 'object'
    and octet_length(notification_prefs::text) <= 2048
  )
);

comment on table public.account_private is
  'Owner-only account settings. Email is intentionally absent; it lives only in auth.users and must not be copied here.';

alter table public.account_private enable row level security;

create policy account_private_select_own
  on public.account_private
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy account_private_update_own
  on public.account_private
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on policy account_private_select_own on public.account_private is
  'Owner-only forever. Do not add a circle-membership clause. Co-members read profiles, not this table.';

comment on policy account_private_update_own on public.account_private is
  'Owner-only forever. There is no insert or delete policy; the signup trigger inserts, and deleting the auth user cascades.';

revoke all on table public.account_private from public, anon, authenticated;
grant select on table public.account_private to authenticated;
-- user_id and created_at are not updatable by clients.
grant update (age_confirmed_at, notification_prefs)
  on table public.account_private to authenticated;

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------
--
-- Same profile rules as week 1, plus an account_private row.
-- security definer so the insert works without an insert policy.
-- search_path is empty. Do not read new.email.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_display_name text;
  new_avatar_path text;
  new_timezone text;
begin
  new_display_name := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  )), '');

  -- Provider metadata sometimes contains the email in a name field.
  -- Drop anything that looks like one. Do not read new.email at all.
  if new_display_name is null
     or char_length(new_display_name) > 80
     or position('@' in new_display_name) > 0 then
    new_display_name := 'New member';
  end if;

  new_avatar_path := nullif(btrim(coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  )), '');

  if new_avatar_path is null
     or char_length(new_avatar_path) > 512
     or left(new_avatar_path, 8) <> 'https://' then
    new_avatar_path := null;
  end if;

  new_timezone := nullif(btrim(new.raw_user_meta_data ->> 'timezone'), '');
  if new_timezone is null or new_timezone !~ '^[A-Za-z0-9_+/-]{1,64}$' then
    new_timezone := 'UTC';
  end if;

  insert into public.profiles (id, display_name, avatar_path, timezone)
  values (new.id, new_display_name, new_avatar_path, new_timezone);

  insert into public.account_private (user_id)
  values (new.id);

  return new;
end;
$$;

-- People who signed up before this migration have a profile and no private row.
insert into public.account_private (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Profile shape
-- ---------------------------------------------------------------------------
--
-- Week 1 allowed any avatar string up to 512 characters. Keep that length
-- check. Add a shape check: a legacy https provider URL, or an object path
-- whose first folder is this profile's id.
--
-- A client update still cannot point avatar_path at a new https URL. That
-- rule is the before-update trigger below, so a profile cannot become a
-- tracking pixel once co-members can read it.

alter table public.profiles
  add constraint profiles_avatar_path_shape check (
    avatar_path is null
    or avatar_path ~ '^https://[^\s]{1,500}$'
    or avatar_path ~ (
      '^'
      || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );

comment on column public.profiles.avatar_path is
  'Null, a legacy https provider URL from signup, or {user id}/{uuid}.jpg|png|webp in the private avatars bucket.';

-- Clients could previously update id and created_at. They never need to.
revoke update on table public.profiles from authenticated;
grant update (display_name, avatar_path, timezone)
  on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not in the Data API)
-- ---------------------------------------------------------------------------
--
-- config.toml exposes public and graphql_public only. Functions here are
-- callable from RLS policies and invisible to PostgREST.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

comment on schema private is
  'RLS helpers. Not exposed through the Data API.';

create function private.uuid_or_null(value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then value::uuid
    else null
  end;
$$;

create function private.can_read_profile(profile_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  -- Owner-only until circles exist.
  --
  -- Week 3: when public.circle_members exists, replace this expression with
  -- the plan's profiles_read rule. Do not reference account_private or
  -- auth.users. If circle_members RLS hides the rows this join needs, switch
  -- this function to security definer (empty search_path), same as the
  -- planned is_active_member() helper.
  --
  --   select profile_id = (select auth.uid())
  --      or exists (
  --        select 1
  --        from public.circle_members me
  --        join public.circle_members them
  --          on them.circle_id = me.circle_id
  --        where me.user_id = (select auth.uid())
  --          and me.left_at is null
  --          and them.user_id = profile_id
  --          and them.left_at is null
  --      );
  select profile_id is not null
     and profile_id = (select auth.uid());
$$;

revoke all on function private.uuid_or_null(text) from public, anon, authenticated;
revoke all on function private.can_read_profile(uuid) from public, anon, authenticated;
grant execute on function private.uuid_or_null(text) to authenticated;
grant execute on function private.can_read_profile(uuid) to authenticated;

-- Select delegates to the helper so week 3 edits one function.
-- Update stays "id = auth.uid()" and must not start using the helper:
-- co-members will be allowed to read, not to write.
alter policy profiles_select_own
  on public.profiles
  to authenticated
  using (private.can_read_profile(id));

comment on policy profiles_select_own on public.profiles is
  'Delegates to private.can_read_profile. Week 3 widens that function; leave this policy in place.';

comment on policy profiles_update_own on public.profiles is
  'Owner-only. Do not point this at can_read_profile. Co-members must not update someone else''s profile.';

create function private.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'profile id and created_at cannot change';
  end if;

  if new.avatar_path is not distinct from old.avatar_path then
    return new;
  end if;

  -- Clearing the photo, or replacing it with a file in this user's folder.
  -- A new https URL is rejected even though the check constraint still
  -- allows the legacy value the signup trigger wrote.
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

revoke all on function private.profiles_guard_update() from public, anon, authenticated;
grant execute on function private.profiles_guard_update() to authenticated;

create trigger profiles_guard_update
  before update on public.profiles
  for each row
  execute function private.profiles_guard_update();

-- ---------------------------------------------------------------------------
-- avatars bucket
-- ---------------------------------------------------------------------------
--
-- Private. The browser never receives a public object URL. The app creates a
-- short-lived signed URL after can_read_profile would allow the read.
-- Object names are {user id}/{uuid}.jpg|png|webp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy avatars_select_visible
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and private.can_read_profile(
      private.uuid_or_null((storage.foldername(name))[1])
    )
  );

comment on policy avatars_select_visible on storage.objects is
  'Same visibility as profiles, via private.can_read_profile. Week 3 does not need a new storage policy.';

-- Insert and delete stay owner-only. Do not switch them to can_read_profile:
-- seeing a co-member's photo must not allow replacing the file.
create policy avatars_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  );

create policy avatars_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on policy avatars_insert_own on storage.objects is
  'Owner-only upload into {auth.uid}/{uuid}.jpg|png|webp. There is no update policy; replace a photo by uploading a new object and deleting the old one.';

comment on policy avatars_delete_own on storage.objects is
  'Owner-only. Co-members must not gain delete when can_read_profile grows in week 3.';
