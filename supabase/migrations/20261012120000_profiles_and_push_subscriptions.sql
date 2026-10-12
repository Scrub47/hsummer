-- Week 1 accounts foundation.
--
-- Circles, letters, and every other content table come in later migrations.
-- This file only creates what sign-in and the web-push spike need:
--   * profiles        — what another person may eventually see
--   * push_subscriptions — this user's devices
--
-- Email is not a column here. It stays in auth.users, which the Data API
-- does not expose. A later migration will let co-members read display_name,
-- avatar_path, and timezone. Until circles exist, both tables are owner-only.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- Same id as auth.users. Deleting the auth user deletes the profile.
  id uuid primary key references auth.users (id) on delete cascade,
  -- Shown later to people who share a circle. Never an email address.
  display_name text not null,
  -- Optional picture. Week 1 may store an https provider URL. A later week
  -- should switch this to a path in a private Storage bucket.
  avatar_path text,
  -- IANA name, for example America/Los_Angeles. Letter delivery uses this later.
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  constraint profiles_display_name_ok check (
    char_length(display_name) between 1 and 80
    and position('@' in display_name) = 0
  ),
  constraint profiles_avatar_path_ok check (
    avatar_path is null or char_length(avatar_path) between 1 and 512
  ),
  constraint profiles_timezone_ok check (
    timezone ~ '^[A-Za-z0-9_+/-]{1,64}$'
  )
);

comment on table public.profiles is
  'Public-facing profile. Email is intentionally absent; it lives only in auth.users.';

alter table public.profiles enable row level security;

-- (select auth.uid()) is evaluated once per statement, not once per row.
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert or delete policy. The trigger below inserts the row, and deleting
-- the auth user cascades. A client insert policy would let someone create a
-- profile for an id they don't own if the check were written wrong.

-- Newer Supabase CLIs do not always grant Data API access automatically.
-- Revoke first so anon cannot read profiles even if a default privilege did.
revoke all on table public.profiles from public, anon, authenticated;
grant select, update on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------
--
-- security definer runs as the function owner (the migration role), which
-- also owns public.profiles, so the insert bypasses RLS. That is what we
-- want: the signed-up user has no insert policy.
--
-- search_path is empty so a user cannot shadow pg functions with objects in
-- a schema they can write. Every table reference is schema-qualified.
-- If this function raises, Supabase aborts the signup. Keep it defensive.

create function public.handle_new_user()
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

  return new;
end;
$$;

-- Clients must not call this directly. The trigger still can.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
--
-- One row per browser (or installed PWA) on this account. The push payload
-- itself is built in the app and must not contain private content; the
-- database only stores the delivery address.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint),
  constraint push_subscriptions_endpoint_ok check (
    endpoint like 'https://%'
    and char_length(endpoint) between 12 and 2048
  ),
  constraint push_subscriptions_p256dh_ok check (
    char_length(p256dh) between 1 and 200
  ),
  constraint push_subscriptions_auth_ok check (
    char_length(auth) between 1 and 200
  )
);

comment on table public.push_subscriptions is
  'Web Push subscriptions for one user''s devices. Owner-only. Delete a row when the push service returns 404 or 410.';

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Upsert is insert-or-update, so the owner needs both.
create policy push_subscriptions_update_own
  on public.push_subscriptions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
