-- Resume numbers for Hsummer.
--
-- Paste this file into the Supabase SQL editor and run it. Every statement
-- is a SELECT. Nothing here inserts, updates, or deletes.
--
-- Demo accounts and the demo circle are left out. A letter that was
-- cancelled does not count as sent. Activity, for weekly use and for
-- retention, is any of: a letter sent, a ping, a memory, a mood update,
-- joining a circle, or sending feedback.
--
-- The SQL editor runs as the table owner, so it can read public.feedback
-- even though signed-in people cannot. Authenticated has insert only.

with people as (
  select profile.id, account.created_at
  from public.profiles as profile
  join public.account_private as account on account.user_id = profile.id
  where account.is_demo = false
),
activity as (
  select letter.from_user_id as user_id, letter.circle_id, letter.created_at as at
  from public.letters as letter
  join public.circles as circle on circle.id = letter.circle_id
  where letter.status <> 'cancelled'
    and letter.from_user_id is not null
    and circle.is_demo = false
  union all
  select ping.from_user_id, ping.circle_id, ping.sent_at
  from public.pings as ping
  join public.circles as circle on circle.id = ping.circle_id
  where ping.from_user_id is not null
    and circle.is_demo = false
  union all
  select memory.created_by, memory.circle_id, memory.created_at
  from public.memories as memory
  join public.circles as circle on circle.id = memory.circle_id
  where memory.created_by is not null
    and circle.is_demo = false
  union all
  select mood.user_id, mood.circle_id, mood.updated_at
  from public.current_moods as mood
  join public.circles as circle on circle.id = mood.circle_id
  where circle.is_demo = false
  union all
  select member.user_id, member.circle_id, member.joined_at
  from public.circle_members as member
  join public.circles as circle on circle.id = member.circle_id
  where circle.is_demo = false
  union all
  select note.user_id, null::uuid, note.created_at
  from public.feedback as note
  join public.account_private as account on account.user_id = note.user_id
  where account.is_demo = false
),
cohort_7 as (
  select person.id
  from people as person
  where person.created_at <= pg_catalog.now() - interval '7 days'
    and exists (
      select 1
      from activity
      where activity.user_id = person.id
        and activity.at >= person.created_at + interval '7 days'
    )
),
eligible_7 as (
  select person.id
  from people as person
  where person.created_at <= pg_catalog.now() - interval '7 days'
),
cohort_30 as (
  select person.id
  from people as person
  where person.created_at <= pg_catalog.now() - interval '30 days'
    and exists (
      select 1
      from activity
      where activity.user_id = person.id
        and activity.at >= person.created_at + interval '30 days'
    )
),
eligible_30 as (
  select person.id
  from people as person
  where person.created_at <= pg_catalog.now() - interval '30 days'
)
select
  (select count(*) from people) as total_users,
  (
    select count(distinct activity.user_id)
    from activity
    where activity.at >= pg_catalog.now() - interval '7 days'
  ) as weekly_active_users,
  (
    select count(*)
    from public.circles
    where is_demo = false
  ) as total_circles,
  (
    select count(distinct activity.circle_id)
    from activity
    where activity.circle_id is not null
      and activity.at >= pg_catalog.now() - interval '7 days'
  ) as weekly_active_circles,
  (
    select count(*)
    from public.letters as letter
    join public.circles as circle on circle.id = letter.circle_id
    where letter.status <> 'cancelled'
      and circle.is_demo = false
  ) as letters_sent,
  (
    select count(*)
    from public.pings as ping
    join public.circles as circle on circle.id = ping.circle_id
    where circle.is_demo = false
  ) as pings,
  (select count(*) from cohort_7) as retained_after_7_days,
  (select count(*) from eligible_7) as eligible_for_7_day_retention,
  (
    select round(
      100.0 * (select count(*) from cohort_7)
      / nullif((select count(*) from eligible_7), 0),
      1
    )
  ) as retention_7_day_percent,
  (select count(*) from cohort_30) as retained_after_30_days,
  (select count(*) from eligible_30) as eligible_for_30_day_retention,
  (
    select round(
      100.0 * (select count(*) from cohort_30)
      / nullif((select count(*) from eligible_30), 0),
      1
    )
  ) as retention_30_day_percent,
  (
    select round(avg(note.rating)::numeric, 2)
    from public.feedback as note
    join public.account_private as account on account.user_id = note.user_id
    where account.is_demo = false
  ) as average_feedback_rating,
  (
    select count(*)
    from public.feedback as note
    join public.account_private as account on account.user_id = note.user_id
    where account.is_demo = false
  ) as feedback_count;
