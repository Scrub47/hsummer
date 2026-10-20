-- Feedback, and the two account settings that go with it.
--
-- Additive on top of 20271019120000_purge_expired_pings.sql.
-- Safe to paste into the Supabase SQL editor more than once.
-- Do not edit or re-run earlier files.
--
-- public.feedback is insert-only for the signed-in author. There is no
-- select, update, or delete policy, and authenticated is not granted
-- select. The service role bypasses row level security and can read the
-- rows. The SQL editor, as the table owner, can read them too. That is
-- how docs/metrics.sql gets the average rating.
--
-- Email is not a column. The note is optional and capped at 1000
-- characters. The trigger stamps the author and the clock, so a client
-- cannot file the row under someone else or backdate it.
--
-- account_private gains analytics_opt_out and
-- feedback_prompt_dismissed_at. Both stay owner-only because the table
-- already is. A dismissal, once set, cannot be cleared by a later update.

alter table public.account_private
  add column if not exists analytics_opt_out boolean not null default false;

alter table public.account_private
  add column if not exists feedback_prompt_dismissed_at timestamptz;

comment on column public.account_private.analytics_opt_out is
  'True when this person has turned off product analytics. The browser applies it immediately. Email is not stored here.';

comment on column public.account_private.feedback_prompt_dismissed_at is
  'Set when the one-time check-in is closed or answered. A later update cannot clear it.';

grant update (analytics_opt_out, feedback_prompt_dismissed_at)
  on table public.account_private to authenticated;

create or replace function private.account_private_keep_prompt_dismissal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.feedback_prompt_dismissed_at is not null
     and new.feedback_prompt_dismissed_at
       is distinct from old.feedback_prompt_dismissed_at then
    new.feedback_prompt_dismissed_at := old.feedback_prompt_dismissed_at;
  end if;
  return new;
end;
$$;

revoke all on function private.account_private_keep_prompt_dismissal()
  from public, anon, authenticated;

drop trigger if exists account_private_keep_prompt_dismissal
  on public.account_private;

create trigger account_private_keep_prompt_dismissal
  before update on public.account_private
  for each row
  execute function private.account_private_keep_prompt_dismissal();

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null,
  message text,
  category text,
  app_version text not null,
  user_agent text not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint feedback_rating_range check (rating between 1 and 5),
  constraint feedback_message_length check (
    message is null or char_length(message) between 1 and 1000
  ),
  constraint feedback_category_known check (
    category is null or category in ('bug', 'idea', 'love')
  ),
  constraint feedback_app_version_length check (
    char_length(app_version) between 1 and 32
  ),
  constraint feedback_user_agent_length check (
    char_length(user_agent) between 1 and 512
  )
);

comment on table public.feedback is
  'Insert-only notes for the person who runs Hsummer. No email column. Authenticated cannot select. The service role can read.';

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_own on public.feedback;

create policy feedback_insert_own
  on public.feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

comment on policy feedback_insert_own on public.feedback is
  'The author may insert their own row. There is no select, update, or delete policy.';

revoke all on table public.feedback from public, anon, authenticated;
grant insert on table public.feedback to authenticated;
grant select on table public.feedback to service_role;

create index if not exists feedback_user_created_idx
  on public.feedback (user_id, created_at desc);

-- Counts rows the author cannot select, so this has to be security definer.
-- search_path is empty. It does not read auth.users.email.

create or replace function private.feedback_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  if auth.uid() is null then
    raise exception 'hsummer_feedback_sign_in';
  end if;

  if exists (
    select 1
    from public.account_private as account
    where account.user_id = auth.uid()
      and account.is_demo
  ) then
    raise exception 'hsummer_demo_readonly';
  end if;

  new.user_id := auth.uid();
  new.created_at := pg_catalog.now();
  if new.message is not null then
    new.message := nullif(pg_catalog.btrim(new.message), '');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hsummer-feedback:' || auth.uid()::text, 0)
  );

  select count(*)::integer
    into recent
  from public.feedback
  where user_id = auth.uid()
    and created_at > pg_catalog.now() - interval '1 hour';

  if recent >= 5 then
    raise exception 'hsummer_feedback_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function private.feedback_guard_insert()
  from public, anon, authenticated;

drop trigger if exists feedback_guard_insert on public.feedback;

create trigger feedback_guard_insert
  before insert on public.feedback
  for each row
  execute function private.feedback_guard_insert();
