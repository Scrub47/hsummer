-- Week 12: scheduled letters and Still Us.
--
-- Additive on top of 20261221120000_letters.sql.
-- Safe to run once against a database that already has weeks 1–11.
-- Do not edit or re-run those files.
--
-- This adds:
--   * a signed-in writer may set letters.scheduled_for (a future instant)
--   * public.deliver_scheduled_letter — QStash callback, service role only
--   * public.deliver_due_letters — if QStash is not configured, opening the
--     app delivers a letter whose time has passed
--   * public.countdowns and public.checkpoints
--   * one Still Us row for each couple circle, including circles that
--     already exist
--   * public.sync_auto_checkpoints and public.hit_checkpoint
--   * memories.kind 'milestone' and memories.checkpoint_id
--
-- qstash_message_id stays off the authenticated grants. The server stores
-- it with the secret key after QStash accepts the message, and deletes that
-- message when the sender cancels or changes the time.
--
-- The SQL editor may flag DROP CONSTRAINT. Two checks on memories are
-- replaced so kind 'milestone' is allowed. No row, policy, or bucket is
-- deleted. Photo, note, and letter rows still match the new checks.
--
-- letters_insert_sender is changed with ALTER POLICY. That replaces the
-- check expression so a future scheduled_for can be stored. It does not
-- drop the policy and does not delete letters.
--
-- REVOKE ALL appears on the new tables and the new functions, and only
-- before their grants. It removes the default PUBLIC privilege on those
-- new objects. It does not revoke anything from letters, memories, or
-- any table that already existed.
--
-- CREATE OR REPLACE FUNCTION replaces letters_guard and memories_guard.
-- The triggers that call them stay. No table is dropped. Run the file as
-- one script. CREATE TRIGGER is not repeatable. If it stops halfway, read
-- the error before pasting again.
--
-- Couples get one countdown. That limit is a trigger, not a policy, so
-- circle_type is still not an access rule. A group can hold several.

-- ---------------------------------------------------------------------------
-- Letters: the sender may name a future instant
-- ---------------------------------------------------------------------------

grant insert (scheduled_for) on table public.letters to authenticated;

grant update (scheduled_for) on table public.letters to authenticated;

comment on column public.letters.scheduled_for is
  'Null delivers now. A UTC instant is the recipient''s local time. The sender can set a time at least a minute ahead and at most two years ahead. qstash_message_id is still not granted.';

comment on column public.letters.qstash_message_id is
  'QStash message id. The secret key writes it. Cancel that message when the time changes or the letter is cancelled. Hidden from authenticated.';

alter policy letters_insert_sender
  on public.letters
  with check (
    from_user_id = (select auth.uid())
    and private.is_active_member(circle_id)
    and to_user_id is distinct from (select auth.uid())
    and private.is_active_member_user(circle_id, to_user_id)
    and opened_at is null
    and (
      (
        scheduled_for is null
        and status = 'delivered'
        and delivered_at is not null
      )
      or (
        scheduled_for > pg_catalog.now()
        and status = 'scheduled'
        and delivered_at is null
      )
    )
  );

comment on policy letters_insert_sender on public.letters is
  'You write as yourself to another active member. The trigger delivers it now, or keeps it scheduled when scheduled_for is in the future.';

-- ---------------------------------------------------------------------------
-- letters_guard: keep a future row scheduled
-- ---------------------------------------------------------------------------

create or replace function private.letters_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent integer;
  opening text := pg_catalog.current_setting('hsummer.letter_open', true);
  delivering text := pg_catalog.current_setting('hsummer.letter_deliver', true);
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
         or new.scheduled_for is distinct from old.scheduled_for
         or new.qstash_message_id is distinct from old.qstash_message_id
      then
        raise exception 'hsummer_letter_locked';
      end if;
      return new;
    end if;

    if delivering = '1' then
      if new.body is distinct from old.body
         or new.title is distinct from old.title
         or new.category is distinct from old.category
         or new.design is distinct from old.design
         or new.scheduled_for is distinct from old.scheduled_for
         or new.qstash_message_id is distinct from old.qstash_message_id
         or new.opened_at is not null
      then
        raise exception 'hsummer_letter_locked';
      end if;

      if old.status is distinct from 'scheduled' or old.delivered_at is not null then
        raise exception 'hsummer_letter_locked';
      end if;

      if new.status = 'delivered' then
        if old.scheduled_for is null
           or old.scheduled_for > pg_catalog.now() + interval '2 minutes'
        then
          raise exception 'hsummer_letter_schedule';
        end if;
        if new.delivered_at is null then
          new.delivered_at := pg_catalog.now();
        end if;
        return new;
      end if;

      if new.status = 'cancelled' then
        new.delivered_at := null;
        new.opened_at := null;
        return new;
      end if;

      raise exception 'hsummer_letter_locked';
    end if;

    if actor is not null then
      if new.qstash_message_id is distinct from old.qstash_message_id then
        raise exception 'hsummer_letter_locked';
      end if;

      if actor is distinct from old.from_user_id
         or old.status is distinct from 'scheduled'
         or old.delivered_at is not null
         or new.delivered_at is not null
         or new.opened_at is not null
         or new.status not in ('scheduled', 'cancelled')
      then
        raise exception 'hsummer_letter_locked';
      end if;

      if new.status = 'scheduled'
         and new.scheduled_for is distinct from old.scheduled_for
         and (
           new.scheduled_for is null
           or new.scheduled_for <= pg_catalog.now() + interval '1 minute'
           or new.scheduled_for > pg_catalog.now() + interval '2 years'
         )
      then
        raise exception 'hsummer_letter_schedule';
      end if;
    else
      if new.scheduled_for is distinct from old.scheduled_for
         or new.body is distinct from old.body
         or new.title is distinct from old.title
         or new.category is distinct from old.category
         or new.design is distinct from old.design
      then
        raise exception 'hsummer_letter_locked';
      end if;

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
  new.qstash_message_id := null;
  new.opened_at := null;
  new.created_at := pg_catalog.now();

  if new.scheduled_for is null then
    new.status := 'delivered';
    new.delivered_at := pg_catalog.now();
  elsif new.scheduled_for > pg_catalog.now() + interval '1 minute'
        and new.scheduled_for <= pg_catalog.now() + interval '2 years'
  then
    new.status := 'scheduled';
    new.delivered_at := null;
  else
    raise exception 'hsummer_letter_schedule';
  end if;

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

comment on function private.letters_guard() is
  'Delivers a letter written for now. Keeps a letter scheduled when the sender picks a time at least a minute ahead. Allows 10 letters per 10 minutes.';

create index if not exists letters_due_idx
  on public.letters (circle_id, scheduled_for)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Deliver a scheduled letter
-- ---------------------------------------------------------------------------

create function public.deliver_scheduled_letter(target uuid)
returns text
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
  found_status text;
  found_scheduled timestamptz;
begin
  -- The QStash route calls this with the secret key. A signed-in session
  -- uses deliver_due_letters instead, and only for a letter that is already due.
  if actor is not null or target is null then
    raise exception 'hsummer_letter_deliver';
  end if;

  select
    letter.id,
    letter.circle_id,
    letter.from_user_id,
    letter.to_user_id,
    letter.status,
    letter.scheduled_for
    into
      found_id,
      found_circle,
      found_from,
      found_to,
      found_status,
      found_scheduled
  from public.letters as letter
  where letter.id = target
  for update;

  if not found then
    return 'missing';
  end if;

  if found_status = 'delivered' then
    return 'already';
  end if;

  if found_status is distinct from 'scheduled' then
    return 'cancelled';
  end if;

  if found_scheduled is null
     or found_scheduled > pg_catalog.now() + interval '2 minutes'
  then
    return 'early';
  end if;

  if found_from is null
     or not private.is_active_member_user(found_circle, found_from)
     or not private.is_active_member_user(found_circle, found_to)
  then
    update public.letters
    set status = 'cancelled'
    where id = found_id;
    return 'cancelled';
  end if;

  update public.letters
  set status = 'delivered',
      delivered_at = pg_catalog.now()
  where id = found_id;

  return 'delivered';
end;
$$;

revoke all on function public.deliver_scheduled_letter(uuid)
  from public, anon, authenticated;

grant execute on function public.deliver_scheduled_letter(uuid) to service_role;

comment on function public.deliver_scheduled_letter(uuid) is
  'Service role only. Delivers one scheduled letter after both people are still active members. Returns delivered, already, cancelled, missing, or early.';

create function public.deliver_due_letters(target_circle uuid)
returns table (letter_id uuid, to_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  due_id uuid;
  due_from uuid;
  due_to uuid;
  due_at timestamptz;
begin
  if actor is null
     or target_circle is null
     or not private.is_active_member(target_circle)
  then
    return;
  end if;

  perform pg_catalog.set_config('hsummer.letter_deliver', '1', true);

  for due_id, due_from, due_to, due_at in
    select letter.id, letter.from_user_id, letter.to_user_id, letter.scheduled_for
    from public.letters as letter
    where letter.circle_id = target_circle
      and letter.status = 'scheduled'
      and letter.scheduled_for is not null
      and letter.scheduled_for <= pg_catalog.now()
      and (
        letter.from_user_id = actor
        or letter.to_user_id = actor
      )
    order by letter.scheduled_for
    limit 20
    for update
  loop
    if due_from is null
       or not private.is_active_member_user(target_circle, due_from)
       or not private.is_active_member_user(target_circle, due_to)
    then
      update public.letters
      set status = 'cancelled'
      where id = due_id;
    else
      update public.letters
      set status = 'delivered',
          delivered_at = pg_catalog.now()
      where id = due_id;
      letter_id := due_id;
      to_user_id := due_to;
      return next;
    end if;
  end loop;

  perform pg_catalog.set_config('hsummer.letter_deliver', '', true);
end;
$$;

revoke all on function public.deliver_due_letters(uuid)
  from public, anon, authenticated;

grant execute on function public.deliver_due_letters(uuid) to authenticated;

comment on function public.deliver_due_letters(uuid) is
  'The caller is an active member. Delivers scheduled letters in this circle that are addressed to or from them and whose time has passed. One row per letter that just arrived.';

-- ---------------------------------------------------------------------------
-- Still Us
-- ---------------------------------------------------------------------------

create table public.countdowns (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  label text not null default 'Still Us',
  -- Null until the circle picks the reunion day.
  target_date date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint countdowns_label_shape check (
    char_length(label) between 1 and 80
    and position('@' in label) = 0
    and label !~ '[[:cntrl:]]'
  ),
  constraint countdowns_target_sane check (
    target_date is null
    or (
      target_date >= date '1900-01-01'
      and target_date <= date '2100-12-31'
    )
  )
);

comment on table public.countdowns is
  'A reunion date for one circle. Every active member can read it. A couple has one, created with the circle.';

comment on column public.countdowns.target_date is
  'Calendar date, no time and no zone. Days remaining use the viewer''s own timezone. Null until the date is chosen.';

comment on column public.countdowns.label is
  'Shown above the count. Defaults to Still Us. 1–80 characters, no @.';

create index countdowns_circle_idx
  on public.countdowns (circle_id, created_at);

alter table public.countdowns enable row level security;

alter table public.countdowns replica identity full;

revoke all on table public.countdowns from public, anon, authenticated;

grant select on table public.countdowns to authenticated;

grant insert (circle_id, label, target_date, created_by)
  on table public.countdowns to authenticated;

grant update (label, target_date)
  on table public.countdowns to authenticated;

grant delete on table public.countdowns to authenticated;

grant select, insert, update, delete on table public.countdowns to service_role;

create table public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  countdown_id uuid not null references public.countdowns (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  label text not null,
  date date not null,
  trigger text not null,
  hit_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint checkpoints_label_shape check (
    char_length(label) between 1 and 80
    and position('@' in label) = 0
    and label !~ '[[:cntrl:]]'
  ),
  constraint checkpoints_date_sane check (
    date >= date '1900-01-01'
    and date <= date '2100-12-31'
  ),
  constraint checkpoints_trigger_known check (
    trigger in ('auto-by-date', 'manual')
  )
);

comment on table public.checkpoints is
  'A milestone on a countdown. auto-by-date is hit when someone in the circle opens the app on or after that calendar date in their own timezone. manual waits for a tap.';

comment on column public.checkpoints.hit_at is
  'Set once. The client cannot write it. Hitting it files one circle-visible memory.';

create index checkpoints_circle_idx
  on public.checkpoints (circle_id, date);

create index checkpoints_countdown_idx
  on public.checkpoints (countdown_id, date);

alter table public.checkpoints enable row level security;

alter table public.checkpoints replica identity full;

revoke all on table public.checkpoints from public, anon, authenticated;

grant select on table public.checkpoints to authenticated;

-- hit_at stays off this grant. sync_auto_checkpoints and hit_checkpoint set it.
grant insert (countdown_id, circle_id, label, date, trigger, created_by)
  on table public.checkpoints to authenticated;

grant update (label, date, trigger)
  on table public.checkpoints to authenticated;

grant delete on table public.checkpoints to authenticated;

grant select, insert, update, delete on table public.checkpoints to service_role;

-- ---------------------------------------------------------------------------
-- Countdown policies and guard
-- ---------------------------------------------------------------------------

create policy countdowns_select_member
  on public.countdowns
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy countdowns_select_member on public.countdowns is
  'Active members read the circle''s countdowns. An outsider and a member who left get nothing.';

create policy countdowns_insert_member
  on public.countdowns
  for insert
  to authenticated
  with check (
    private.is_active_member(circle_id)
    and created_by = (select auth.uid())
  );

comment on policy countdowns_insert_member on public.countdowns is
  'An active member adds a countdown as themselves. A couple''s second row is refused by the trigger.';

create policy countdowns_update_member
  on public.countdowns
  for update
  to authenticated
  using (private.is_active_member(circle_id))
  with check (private.is_active_member(circle_id));

comment on policy countdowns_update_member on public.countdowns is
  'An active member can change the label and the reunion date.';

create policy countdowns_delete_member
  on public.countdowns
  for delete
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy countdowns_delete_member on public.countdowns is
  'An active member can remove a countdown. A couple''s only countdown is refused by the trigger.';

create function private.countdowns_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  found_type text;
begin
  if tg_op = 'DELETE' then
    select circle.circle_type
      into found_type
    from public.circles as circle
    where circle.id = old.circle_id;

    if found_type = 'couple' then
      raise exception 'hsummer_countdown_couple';
    end if;

    return old;
  end if;

  if new.label is null then
    new.label := 'Still Us';
  end if;

  new.label := pg_catalog.regexp_replace(
    pg_catalog.btrim(new.label),
    '\s+',
    ' ',
    'g'
  );

  if new.label = '' then
    new.label := 'Still Us';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.circle_id is distinct from old.circle_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
    then
      raise exception 'hsummer_countdown_locked';
    end if;
    return new;
  end if;

  if actor is not null then
    if new.created_by is not null and new.created_by is distinct from actor then
      raise exception 'hsummer_countdown';
    end if;
    new.created_by := actor;
    new.created_at := pg_catalog.now();
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hsummer-countdown:' || new.circle_id::text,
      0
    )
  );

  select circle.circle_type
    into found_type
  from public.circles as circle
  where circle.id = new.circle_id;

  if found_type = 'couple'
     and exists (
       select 1
       from public.countdowns as countdown
       where countdown.circle_id = new.circle_id
     )
  then
    raise exception 'hsummer_countdown_couple';
  end if;

  return new;
end;
$$;

revoke all on function private.countdowns_guard()
  from public, anon, authenticated;

create trigger countdowns_guard
  before insert or update or delete on public.countdowns
  for each row
  execute function private.countdowns_guard();

comment on function private.countdowns_guard() is
  'A couple keeps the one countdown created with the circle. The type is not used by the policies.';

create function private.circles_seed_countdown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.circle_type = 'couple' then
    insert into public.countdowns (circle_id, label, target_date, created_by)
    values (new.id, 'Still Us', null, new.created_by);
  end if;
  return new;
end;
$$;

revoke all on function private.circles_seed_countdown()
  from public, anon, authenticated;

create trigger circles_seed_countdown
  after insert on public.circles
  for each row
  execute function private.circles_seed_countdown();

comment on function private.circles_seed_countdown() is
  'A new couple circle gets one Still Us countdown. Other circle types do not.';

-- Existing couple circles. Inserts the missing row. Does not update or
-- delete a countdown that is already there.
insert into public.countdowns (circle_id, label, target_date, created_by)
select circle.id, 'Still Us', null, circle.created_by
from public.circles as circle
where circle.circle_type = 'couple'
  and not exists (
    select 1
    from public.countdowns as countdown
    where countdown.circle_id = circle.id
  );

-- ---------------------------------------------------------------------------
-- Checkpoint policies and guard
-- ---------------------------------------------------------------------------

create policy checkpoints_select_member
  on public.checkpoints
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy checkpoints_select_member on public.checkpoints is
  'Active members read checkpoints. An outsider and a member who left get nothing.';

create policy checkpoints_insert_member
  on public.checkpoints
  for insert
  to authenticated
  with check (
    private.is_active_member(circle_id)
    and created_by = (select auth.uid())
    and hit_at is null
  );

comment on policy checkpoints_insert_member on public.checkpoints is
  'An active member adds a checkpoint that has not been hit.';

create policy checkpoints_update_member
  on public.checkpoints
  for update
  to authenticated
  using (
    private.is_active_member(circle_id)
    and hit_at is null
  )
  with check (
    private.is_active_member(circle_id)
    and hit_at is null
  );

comment on policy checkpoints_update_member on public.checkpoints is
  'An active member can edit a checkpoint that has not been hit. hit_at is not granted.';

create policy checkpoints_delete_member
  on public.checkpoints
  for delete
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy checkpoints_delete_member on public.checkpoints is
  'An active member can remove a checkpoint. Its memory goes with it.';

create function private.checkpoints_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent integer;
  found_circle uuid;
  hitting text := pg_catalog.current_setting('hsummer.checkpoint_hit', true);
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  new.label := pg_catalog.regexp_replace(
    pg_catalog.btrim(new.label),
    '\s+',
    ' ',
    'g'
  );

  select countdown.circle_id
    into found_circle
  from public.countdowns as countdown
  where countdown.id = new.countdown_id;

  if found_circle is null or found_circle is distinct from new.circle_id then
    raise exception 'hsummer_checkpoint';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.countdown_id is distinct from old.countdown_id
       or new.circle_id is distinct from old.circle_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
    then
      raise exception 'hsummer_checkpoint_locked';
    end if;

    if hitting = '1' then
      if old.hit_at is not null
         or new.hit_at is null
         or new.label is distinct from old.label
         or new.date is distinct from old.date
         or new.trigger is distinct from old.trigger
      then
        raise exception 'hsummer_checkpoint_locked';
      end if;
      return new;
    end if;

    if new.hit_at is distinct from old.hit_at or old.hit_at is not null then
      raise exception 'hsummer_checkpoint_locked';
    end if;

    return new;
  end if;

  if actor is not null then
    if new.created_by is not null and new.created_by is distinct from actor then
      raise exception 'hsummer_checkpoint';
    end if;
    new.created_by := actor;
    new.created_at := pg_catalog.now();
    new.hit_at := null;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hsummer-checkpoint-rate:' || actor::text,
        0
      )
    );

    select count(*)::integer
      into recent
    from public.checkpoints
    where created_by = actor
      and created_at > pg_catalog.now() - interval '10 minutes';

    if recent >= 10 then
      raise exception 'hsummer_rate_limited';
    end if;
  elsif new.hit_at is not null then
    raise exception 'hsummer_checkpoint';
  end if;

  return new;
end;
$$;

revoke all on function private.checkpoints_guard()
  from public, anon, authenticated;

create trigger checkpoints_guard
  before insert or update or delete on public.checkpoints
  for each row
  execute function private.checkpoints_guard();

comment on function private.checkpoints_guard() is
  'The checkpoint has to sit on a countdown in the same circle. hit_at is set only while a hit function is running. 10 new checkpoints per 10 minutes.';

-- ---------------------------------------------------------------------------
-- Viewer-local calendar date
-- ---------------------------------------------------------------------------

create function private.viewer_local_date(actor uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  zone text;
  filed date;
begin
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

  return filed;
end;
$$;

revoke all on function private.viewer_local_date(uuid)
  from public, anon, authenticated;

comment on function private.viewer_local_date(uuid) is
  'The calendar date of now() in that profile''s IANA timezone. Not in the Data API.';

-- ---------------------------------------------------------------------------
-- memories: one milestone per checkpoint
-- ---------------------------------------------------------------------------
--
-- DROP CONSTRAINT replaces the check. It does not delete memories.
-- The new check still accepts every photo, note, and letter.

alter table public.memories
  add column checkpoint_id uuid;

alter table public.memories
  add constraint memories_checkpoint_id_fkey
  foreign key (checkpoint_id) references public.checkpoints (id) on delete cascade;

create unique index memories_one_checkpoint_idx
  on public.memories (checkpoint_id)
  where checkpoint_id is not null;

comment on column public.memories.checkpoint_id is
  'Set only for kind milestone. One memory per checkpoint. Cascade-deletes with the checkpoint. Not granted to authenticated on insert.';

comment on column public.memories.kind is
  'photo, note, letter, or milestone. A milestone has no object. Hitting a checkpoint creates it, visibility circle, for every active member.';

alter table public.memories drop constraint memories_kind_known;

alter table public.memories
  add constraint memories_kind_known
  check (kind in ('photo', 'note', 'letter', 'milestone'));

alter table public.memories drop constraint memories_photo_shape;

alter table public.memories
  add constraint memories_photo_shape
  check (
    (
      kind = 'note'
      and letter_id is null
      and checkpoint_id is null
      and photo_path is null
      and photo_bytes = 0
      and body is not null
    )
    or (
      kind = 'photo'
      and letter_id is null
      and checkpoint_id is null
      and photo_bytes between 1 and 2097152
      and photo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
      and (body is null or char_length(body) <= 280)
    )
    or (
      kind = 'letter'
      and letter_id is not null
      and checkpoint_id is null
      and photo_path is null
      and photo_bytes = 0
      and (body is null or char_length(body) between 1 and 280)
    )
    or (
      kind = 'milestone'
      and checkpoint_id is not null
      and letter_id is null
      and photo_path is null
      and photo_bytes = 0
      and body is not null
      and char_length(body) between 1 and 280
    )
  );

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
  checkpoint_circle uuid;
  checkpoint_hit timestamptz;
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
      new.checkpoint_id := null;
    end if;
  elsif new.kind = 'milestone' then
    if pg_catalog.current_setting('hsummer.checkpoint_hit', true) is distinct from '1' then
      raise exception 'hsummer_checkpoint_memory';
    end if;

    select checkpoint.circle_id, checkpoint.hit_at
      into checkpoint_circle, checkpoint_hit
    from public.checkpoints as checkpoint
    where checkpoint.id = new.checkpoint_id;

    if not found
       or checkpoint_circle is distinct from new.circle_id
       or checkpoint_hit is null
       or actor is null
       or new.created_by is distinct from actor
       or not private.is_active_member(new.circle_id)
    then
      raise exception 'hsummer_checkpoint_memory';
    end if;

    if tg_op = 'INSERT' then
      new.photo_path := null;
      new.photo_bytes := 0;
      new.visibility := 'circle';
      new.letter_id := null;
    end if;
  elsif new.kind = 'note' then
    if new.letter_id is not null or new.checkpoint_id is not null then
      raise exception 'hsummer_letter_memory';
    end if;
    new.photo_path := null;
    new.photo_bytes := 0;
  elsif new.kind = 'photo' then
    if new.letter_id is not null or new.checkpoint_id is not null then
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
    if new.kind = 'letter' or new.kind = 'milestone' then
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
         or new.checkpoint_id is distinct from old.checkpoint_id
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

    if old.kind = 'milestone' or new.kind = 'milestone' then
      if new.kind is distinct from old.kind
         or new.checkpoint_id is distinct from old.checkpoint_id
         or new.letter_id is distinct from old.letter_id
         or new.visibility is distinct from 'circle'
         or new.body is distinct from old.body
         or new.tags is distinct from old.tags
         or new.occurred_on is distinct from old.occurred_on
         or new.photo_path is distinct from old.photo_path
         or new.photo_bytes is distinct from old.photo_bytes
      then
        raise exception 'hsummer_checkpoint_memory';
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
         or new.checkpoint_id is distinct from old.checkpoint_id
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

    if used + new.photo_bytes > 104857600 then
      raise exception 'hsummer_storage_quota';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.memories_guard() is
  'Stamps the author and updated_at, checks the photo path, allows 10 memories per 10 minutes, and caps a circle at 100 MB. A letter memory is created only by open_letter. A milestone is created only while a checkpoint is being hit.';

-- ---------------------------------------------------------------------------
-- File one memory for a hit checkpoint
-- ---------------------------------------------------------------------------

create function private.ensure_checkpoint_memory(target uuid, actor uuid)
returns table (memory_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  fresh uuid;
  found_circle uuid;
  found_label text;
  found_hit timestamptz;
  filed date;
begin
  if actor is null or target is null then
    return;
  end if;

  select checkpoint.circle_id, checkpoint.label, checkpoint.hit_at
    into found_circle, found_label, found_hit
  from public.checkpoints as checkpoint
  where checkpoint.id = target;

  if not found or found_hit is null or not private.is_active_member(found_circle) then
    return;
  end if;

  select memory.id
    into existing
  from public.memories as memory
  where memory.checkpoint_id = target;

  if existing is not null then
    memory_id := existing;
    created := false;
    return next;
    return;
  end if;

  filed := private.viewer_local_date(actor);
  fresh := pg_catalog.gen_random_uuid();

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
      checkpoint_id
    )
    values (
      fresh,
      found_circle,
      actor,
      'milestone',
      pg_catalog.left(found_label, 280),
      null,
      0,
      array['still-us']::text[],
      'circle',
      filed,
      target
    );
    memory_id := fresh;
    created := true;
    return next;
  exception
    when unique_violation then
      select memory.id
        into existing
      from public.memories as memory
      where memory.checkpoint_id = target;
      memory_id := existing;
      created := false;
      return next;
  end;
end;
$$;

revoke all on function private.ensure_checkpoint_memory(uuid, uuid)
  from public, anon, authenticated;

comment on function private.ensure_checkpoint_memory(uuid, uuid) is
  'Inserts the circle-visible memory for a hit checkpoint, or returns the one that is already there. Not in the Data API.';

create function public.sync_auto_checkpoints(target_circle uuid)
returns table (memory_id uuid, checkpoint_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  local_day date;
  due_id uuid;
  filed_memory uuid;
  was_created boolean;
begin
  if actor is null
     or target_circle is null
     or not private.is_active_member(target_circle)
  then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hsummer-checkpoint-sync:' || target_circle::text,
      0
    )
  );

  local_day := private.viewer_local_date(actor);

  perform pg_catalog.set_config('hsummer.checkpoint_hit', '1', true);

  update public.checkpoints as checkpoint
  set hit_at = pg_catalog.now()
  where checkpoint.circle_id = target_circle
    and checkpoint.trigger = 'auto-by-date'
    and checkpoint.hit_at is null
    and checkpoint.date <= local_day;

  for due_id in
    select checkpoint.id
    from public.checkpoints as checkpoint
    where checkpoint.circle_id = target_circle
      and checkpoint.hit_at is not null
      and not exists (
        select 1
        from public.memories as memory
        where memory.checkpoint_id = checkpoint.id
      )
  loop
    select filed.memory_id, filed.created
      into filed_memory, was_created
    from private.ensure_checkpoint_memory(due_id, actor) as filed;

    if was_created and filed_memory is not null then
      memory_id := filed_memory;
      checkpoint_id := due_id;
      return next;
    end if;
  end loop;

  perform pg_catalog.set_config('hsummer.checkpoint_hit', '', true);
end;
$$;

revoke all on function public.sync_auto_checkpoints(uuid)
  from public, anon, authenticated;

grant execute on function public.sync_auto_checkpoints(uuid) to authenticated;

comment on function public.sync_auto_checkpoints(uuid) is
  'On app load. Hits auto-by-date checkpoints whose date is today or earlier in the caller''s timezone, and files one memory each. A second caller finds the memory already there.';

create function public.hit_checkpoint(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  found_id uuid;
  found_circle uuid;
  found_trigger text;
  found_hit timestamptz;
  filed_memory uuid;
begin
  if actor is null or target is null then
    raise exception 'hsummer_checkpoint_hit';
  end if;

  select checkpoint.id, checkpoint.circle_id, checkpoint.trigger, checkpoint.hit_at
    into found_id, found_circle, found_trigger, found_hit
  from public.checkpoints as checkpoint
  where checkpoint.id = target
  for update;

  if not found
     or found_trigger is distinct from 'manual'
     or not private.is_active_member(found_circle)
  then
    raise exception 'hsummer_checkpoint_hit';
  end if;

  perform pg_catalog.set_config('hsummer.checkpoint_hit', '1', true);

  if found_hit is null then
    update public.checkpoints
    set hit_at = pg_catalog.now()
    where id = found_id;
  end if;

  select filed.memory_id
    into filed_memory
  from private.ensure_checkpoint_memory(found_id, actor) as filed;

  perform pg_catalog.set_config('hsummer.checkpoint_hit', '', true);

  if filed_memory is null then
    raise exception 'hsummer_checkpoint_hit';
  end if;

  return filed_memory;
end;
$$;

revoke all on function public.hit_checkpoint(uuid)
  from public, anon, authenticated;

grant execute on function public.hit_checkpoint(uuid) to authenticated;

comment on function public.hit_checkpoint(uuid) is
  'Marks a manual checkpoint hit and returns its one circle-visible memory. A second tap returns the same memory.';

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

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
      and tablename = 'countdowns'
  ) then
    alter publication supabase_realtime add table public.countdowns;
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
      and tablename = 'checkpoints'
  ) then
    alter publication supabase_realtime add table public.checkpoints;
  end if;
end
$$;
