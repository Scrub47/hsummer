-- Security audit v2.
--
-- Additive on top of 20270215120000_group_circles_and_live_together.sql.
-- Safe to paste into the Supabase SQL editor more than once.
-- Do not edit or re-run earlier files.
--
-- Live Together channel policies from that earlier file do not land on a
-- hosted project. realtime.messages is owned by supabase_realtime_admin.
-- The postgres role in the SQL editor is not a superuser and cannot assume
-- that owner, so the old block notices and returns before it creates a
-- policy. ALTER TABLE on realtime.messages fails the same way (must be
-- owner) and would abort the script before any CREATE POLICY that followed.
-- Row level security is already on. This file does not ALTER the table and
-- does not SET ROLE.
--
-- postgres can still CREATE POLICY and DROP POLICY on realtime.messages.
-- Supabase allows those statements for this role. Dropping a policy does
-- not delete a row. realtime.messages does not store broadcasts.
--
-- A policy whose check is just "true" lets every signed-in user join every
-- private broadcast topic. Permissive policies are combined with OR, so one
-- of those would cancel the contributor check. This file drops only those
-- open policies, then creates the two contributor policies again.
--
-- private.can_join_together_topic stays in the private schema, which is not
-- part of the Data API. Authenticated needs EXECUTE because the policy runs
-- as that role. anon and public do not.
--
-- Circle live updates (bucket, moods, memories, letters, checkpoints) join
-- a topic named "<table>:<circle id>" and listen for postgres changes.
-- With "Allow public access" off, a join that omits private: true is
-- rejected. A private join is allowed only when a SELECT on
-- realtime.messages can see a broadcast or presence probe row for that
-- topic. This file adds that read policy for an active member. It does not
-- add an insert policy, so those topics cannot be used to broadcast.
-- The changed rows are still filtered by each table's own policies.
-- Pings are not a Realtime channel.

-- ---------------------------------------------------------------------------
-- The helper the channel policy calls
-- ---------------------------------------------------------------------------

revoke all on function private.can_join_together_topic(text) from public, anon;

grant execute on function private.can_join_together_topic(text) to authenticated;

comment on function private.can_join_together_topic(text) is
  'True when the signed-in person is a contributor of the Live Together or pass session named by the topic, and they are still an active member. Executable by authenticated so the realtime.messages policy can call it. Not in the Data API.';

create or replace function private.can_join_circle_topic(topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    lower(topic) ~ '^(bucket_items|current_moods|memories|letters|checkpoints):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.is_active_member(
      substring(lower(topic) from ':([0-9a-f-]{36})$')::uuid
    );
$$;

revoke all on function private.can_join_circle_topic(text) from public, anon;

grant execute on function private.can_join_circle_topic(text) to authenticated;

comment on function private.can_join_circle_topic(text) is
  'True when the topic is a circle live channel (bucket, mood, memory, letter, or checkpoint) and the signed-in person is still an active member of that circle. Executable by authenticated so the realtime.messages policy can call it. Not in the Data API.';

-- ---------------------------------------------------------------------------
-- Channel policies, without taking ownership of the table
-- ---------------------------------------------------------------------------

do $realtime$
declare
  open_policy record;
begin
  if to_regclass('realtime.messages') is null
     or to_regprocedure('realtime.topic()') is null
  then
    raise notice 'realtime.messages or realtime.topic() is missing; channel policies were skipped';
    return;
  end if;

  for open_policy in
    select policy.polname
    from pg_catalog.pg_policy as policy
    where policy.polrelid = 'realtime.messages'::regclass
      and (
        pg_catalog.btrim(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
        ) in ('true', '(true)')
        or pg_catalog.btrim(
          pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
        ) in ('true', '(true)')
      )
  loop
    execute format(
      'drop policy if exists %I on realtime.messages',
      open_policy.polname
    );
  end loop;

  execute 'drop policy if exists together_channel_read on realtime.messages';
  execute 'drop policy if exists together_channel_write on realtime.messages';

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

  execute 'drop policy if exists circle_channel_read on realtime.messages';

  execute $policy$
    create policy circle_channel_read
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension in ('broadcast', 'presence')
      and private.can_join_circle_topic(realtime.topic())
    )
  $policy$;
end
$realtime$;

-- ---------------------------------------------------------------------------
-- Catalog: the checks above, plus definer functions and anon execute
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
  where n.nspname in ('public', 'private')
    and c.relkind = 'v'
  union all
  select 'anon_grant'::text,
    grants.table_schema || '.' || grants.table_name || ' ' || grants.privilege_type
  from information_schema.role_table_grants as grants
  where grants.grantee = 'anon'
    and grants.table_schema = 'public'
  union all
  select 'definer_search_path'::text,
    n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prosecdef
    and not exists (
      select 1
      from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg like 'search_path=%'
    )
  union all
  select 'anon_execute'::text,
    n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
  union all
  select 'together_channel'::text, 'realtime.messages'
  where to_regclass('realtime.messages') is not null
    and to_regprocedure('realtime.topic()') is not null
    and (
      not exists (
        select 1
        from pg_catalog.pg_policy as policy
        where policy.polrelid = to_regclass('realtime.messages')
          and policy.polname = 'together_channel_read'
      )
      or not exists (
        select 1
        from pg_catalog.pg_policy as policy
        where policy.polrelid = to_regclass('realtime.messages')
          and policy.polname = 'together_channel_write'
      )
      or not pg_catalog.has_function_privilege(
        'authenticated',
        'private.can_join_together_topic(text)',
        'execute'
      )
    )
  union all
  select 'circle_channel'::text, 'realtime.messages'
  where to_regclass('realtime.messages') is not null
    and to_regprocedure('realtime.topic()') is not null
    and (
      not exists (
        select 1
        from pg_catalog.pg_policy as policy
        where policy.polrelid = to_regclass('realtime.messages')
          and policy.polname = 'circle_channel_read'
      )
      or not pg_catalog.has_function_privilege(
        'authenticated',
        'private.can_join_circle_topic(text)',
        'execute'
      )
    )
  union all
  select 'realtime_open'::text, policy.polname::text
  from pg_catalog.pg_policy as policy
  where policy.polrelid = to_regclass('realtime.messages')
    and (
      pg_catalog.btrim(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      ) in ('true', '(true)')
      or pg_catalog.btrim(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
      ) in ('true', '(true)')
    );
$$;

comment on function public.security_audit_gaps() is
  'Rows mean a gap: missing RLS, a public bucket, a view, an anon table or function grant, a security definer without search_path, or a Live Together or circle live channel that is missing or open to everyone. Empty is the passing result. service_role only.';

revoke all on function public.security_audit_gaps() from public, anon, authenticated;

grant execute on function public.security_audit_gaps() to service_role;
