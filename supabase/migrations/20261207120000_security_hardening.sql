-- Security hardening.
--
-- Additive on top of 20261130120000_memories.sql.
-- Safe to run once against a database that already has weeks 1–8.
-- Do not edit or re-run those files.
--
-- The SQL editor may flag REVOKE as destructive. Nothing here deletes a row,
-- a policy, or a bucket. Each REVOKE drops a privilege that is wider than
-- the app uses, and the next statement grants the narrower one back.
-- Authenticated users can still save their own push device. Run the file
-- as one script. CREATE TRIGGER is not repeatable; CREATE OR REPLACE
-- FUNCTION is. If it stops halfway, read the error before pasting again.
--
-- This file:
--   * narrows push_subscriptions so a client cannot set id or created_at,
--     and a trigger refuses moving user_id onto someone else
--   * refuses a ping whose from_user_id is not the signed-in user
--   * records magic-link and Google attempt counts in private.auth_attempts
--   * turns on RLS for the private rate-limit tables (no policies; the
--     table owner, which the security definer functions run as, still
--     bypasses it — that is what lets the functions write the rows)
--   * adds public.security_audit_gaps() so CI can fail when a public or
--     private table has no RLS, a known bucket is public, or anon can
--     read a public table

-- ---------------------------------------------------------------------------
-- push_subscriptions column grants
-- ---------------------------------------------------------------------------

revoke insert on table public.push_subscriptions from authenticated;
revoke update on table public.push_subscriptions from authenticated;

-- id and created_at stay on their defaults. user_id is in the upsert body,
-- so it has to be grantable. The trigger below rejects a change to it.
grant insert (user_id, endpoint, p256dh, auth)
  on table public.push_subscriptions to authenticated;

grant update (user_id, endpoint, p256dh, auth)
  on table public.push_subscriptions to authenticated;

create function private.push_subscriptions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if actor is not null and new.user_id is distinct from actor then
      raise exception 'hsummer_push_owner';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'hsummer_push_locked';
  end if;

  return new;
end;
$$;

revoke all on function private.push_subscriptions_guard()
  from public, anon, authenticated;

create trigger push_subscriptions_guard
  before insert or update on public.push_subscriptions
  for each row
  execute function private.push_subscriptions_guard();

comment on function private.push_subscriptions_guard() is
  'A signed-in user can only store a device on their own account, and cannot change id, user_id, or created_at.';

-- ---------------------------------------------------------------------------
-- pings: sender is the signed-in user
-- ---------------------------------------------------------------------------
--
-- The insert policy already requires from_user_id = auth.uid(). This runs
-- first and rejects a mismatched sender even if that policy were edited.
-- A service-role insert (auth.uid() is null) is unchanged, so tests and
-- later scheduled delivery can still name the sender.

create function private.pings_assign_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    return new;
  end if;

  if new.from_user_id is null then
    new.from_user_id := actor;
    return new;
  end if;

  if new.from_user_id is distinct from actor then
    raise exception 'hsummer_missing_sender';
  end if;

  return new;
end;
$$;

revoke all on function private.pings_assign_sender()
  from public, anon, authenticated;

-- The name sorts before pings_guard_insert, so the sender is checked first.
create trigger pings_assign_sender
  before insert on public.pings
  for each row
  execute function private.pings_assign_sender();

comment on function private.pings_assign_sender() is
  'When a signed-in user inserts a ping, from_user_id must be that user.';

-- ---------------------------------------------------------------------------
-- Auth attempt ledger (not in the Data API)
-- ---------------------------------------------------------------------------

create table private.auth_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  attempted_at timestamptz not null default now(),
  constraint auth_attempts_bucket_ok check (
    bucket ~ '^[a-z0-9:_-]{8,200}$'
  )
);

create index auth_attempts_bucket_time_idx
  on private.auth_attempts (bucket, attempted_at);

revoke all on table private.auth_attempts from public, anon, authenticated;

alter table private.auth_attempts enable row level security;

comment on table private.auth_attempts is
  'Magic-link and Google attempt counts. The bucket is a hash, not an email or a raw IP. Not exposed through the Data API.';

-- join_attempts was created before RLS was the habit for private tables.
-- No policies. The redeem function is security definer and owns the table,
-- so it still inserts. A signed-in role has no grant and no policy.
alter table private.join_attempts enable row level security;

create function public.consume_auth_attempt(
  attempt_bucket text,
  attempt_limit integer,
  attempt_window integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  hits integer;
begin
  if attempt_bucket is null
     or attempt_bucket !~ '^[a-z0-9:_-]{8,200}$'
     or attempt_limit is null
     or attempt_limit < 1
     or attempt_limit > 100
     or attempt_window is null
     or attempt_window < 1
     or attempt_window > 3600 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-auth:' || attempt_bucket, 0)
  );

  delete from private.auth_attempts
  where attempted_at < pg_catalog.now() - interval '1 day';

  select count(*)::integer
    into hits
  from private.auth_attempts
  where bucket = attempt_bucket
    and attempted_at > pg_catalog.now()
      - make_interval(secs => attempt_window);

  if hits >= attempt_limit then
    return false;
  end if;

  insert into private.auth_attempts (bucket)
  values (attempt_bucket);

  return true;
end;
$$;

revoke all on function public.consume_auth_attempt(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.consume_auth_attempt(text, integer, integer)
  to service_role;

comment on function public.consume_auth_attempt(text, integer, integer) is
  'Counts one auth attempt. True when the caller is still under the cap. Executable by service_role only. A bad argument returns false.';

-- ---------------------------------------------------------------------------
-- Catalog check used by the RLS test
-- ---------------------------------------------------------------------------

create function public.security_audit_gaps()
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
    and b.id in ('avatars', 'memories', 'backups')
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

revoke all on function public.security_audit_gaps()
  from public, anon, authenticated;

grant execute on function public.security_audit_gaps() to service_role;

comment on function public.security_audit_gaps() is
  'Rows mean a gap: missing RLS, a public avatars/memories/backups bucket, a public view, or an anon table grant. Empty is the passing result. service_role only.';
