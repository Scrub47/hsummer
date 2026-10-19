-- Thinking of You gestures expire. The app owns the window
-- (PING_RETENTION_DAYS in src/lib/pings/fields.ts) and passes the cutoff,
-- so this file does not repeat the number of days.
--
-- Idempotent: create or replace, then revoke and grant. Re-running does not
-- add a policy. public.pings still has no delete policy, so a member cannot
-- remove a row. This function is the daily cleanup, and only service_role
-- can call it. A signed-in call is refused.
--
-- Demo circles are skipped. The demo write trigger would abort the whole
-- delete if one of those rows were included.

create or replace function public.purge_expired_pings(cutoff timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  if (select auth.uid()) is not null then
    raise exception 'hsummer_not_member';
  end if;

  if cutoff is null then
    raise exception 'hsummer_cutoff_required';
  end if;

  delete from public.pings as ping
  where ping.ping_type = 'thinking-of-you'
    and ping.sent_at < cutoff
    and not private.circle_is_demo(ping.circle_id);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_pings(timestamptz)
  from public, anon, authenticated;

grant execute on function public.purge_expired_pings(timestamptz) to service_role;

comment on function public.purge_expired_pings(timestamptz) is
  'Deletes Thinking of You rows older than cutoff. Skips demo circles. service_role only. A signed-in call is refused. Does not change pings policies.';
