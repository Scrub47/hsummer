-- Week 3 circles and invites.
--
-- Additive on top of 20261019120000_account_private_and_avatars.sql.
-- Safe to run once against a database that already has week 1 and week 2.
-- Do not edit or re-run those files.
--
-- This adds:
--   * circles, circle_members, circle_invites, circle_invite_redemptions
--   * private.is_active_member — the plan's helper, kept out of the Data API
--   * the circle clause inside private.can_read_profile (policies stay put)
--   * create / preview / redeem / regenerate functions for the join flow
--   * a Postgres rate limit on redemption, per user and per IP hash
--
-- account_private stays owner-only. Profile UPDATE stays id = auth.uid().
-- circle_type is a default for the invite (couples get max_uses = 1). It is
-- not used in any RLS policy.
--
-- The raw invite token is returned once by create_circle and
-- regenerate_invite. Only the SHA-256 hash is stored. Clients cannot select
-- token_hash, and they cannot look a token up themselves.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- circles
-- ---------------------------------------------------------------------------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  -- Null when the circle was never named. Addresses are not allowed.
  name text,
  -- Defaults and copy only. Do not branch an RLS policy on this column.
  circle_type text not null,
  -- Null after the creator's account is deleted ("Former member").
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- pending: fewer than 2 active members. active: 2 or more. archived: 0.
  -- Membership changes maintain this. Clients cannot write it.
  status text not null default 'pending',
  constraint circles_type_known check (
    circle_type in ('couple', 'group', 'family', 'friends')
  ),
  constraint circles_status_known check (
    status in ('pending', 'active', 'archived')
  ),
  constraint circles_name_shape check (
    name is null
    or (
      char_length(btrim(name)) between 1 and 80
      and position('@' in name) = 0
    )
  )
);

comment on table public.circles is
  'A private space for two or more people. Pending until a second person joins. Archived when nobody is left.';

comment on column public.circles.circle_type is
  'couple, group, family, or friends. Chooses invite defaults and copy. Never read by an RLS policy.';

comment on column public.circles.status is
  'pending under 2 active members, active at 2 or more, archived at 0. Written by the membership trigger only.';

alter table public.circles enable row level security;

-- ---------------------------------------------------------------------------
-- circle_members
-- ---------------------------------------------------------------------------

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Set when this person leaves. The row stays so history is not rewritten.
  -- Access ends immediately: is_active_member requires left_at is null.
  left_at timestamptz,
  -- Group mute. Unused until that phase. The column exists so the plan's
  -- membership shape does not need another migration.
  muted_until timestamptz,
  primary key (circle_id, user_id),
  constraint circle_members_left_after_join check (
    left_at is null or left_at >= joined_at
  )
);

comment on table public.circle_members is
  'Who is in a circle. left_at ends access and keeps the row. Inserts happen only inside the redemption function.';

create index circle_members_user_active_idx
  on public.circle_members (user_id)
  where left_at is null;

alter table public.circle_members enable row level security;

-- ---------------------------------------------------------------------------
-- circle_invites
-- ---------------------------------------------------------------------------

create table public.circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- SHA-256 hex of the raw token. The raw token is never stored.
  token_hash text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- 1 for a couple. Null means unlimited until expiry.
  max_uses integer,
  use_count integer not null default 0,
  revoked_at timestamptz,
  constraint circle_invites_token_hash_shape check (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint circle_invites_max_uses_positive check (
    max_uses is null or max_uses > 0
  ),
  constraint circle_invites_use_count_nonnegative check (use_count >= 0),
  constraint circle_invites_use_count_within_max check (
    max_uses is null or use_count <= max_uses
  )
);

comment on table public.circle_invites is
  'One live link per circle. Regenerating sets revoked_at on the old row and inserts a new one. Tokens are stored hashed.';

comment on column public.circle_invites.token_hash is
  'SHA-256 hex of the invite token. Authenticated clients are not granted this column.';

create unique index circle_invites_token_hash_key
  on public.circle_invites (token_hash);

-- One unrevoked link at a time. Revoked rows stay for the "turned off" error.
create unique index circle_invites_one_live_key
  on public.circle_invites (circle_id)
  where revoked_at is null;

alter table public.circle_invites enable row level security;

-- ---------------------------------------------------------------------------
-- circle_invite_redemptions
-- ---------------------------------------------------------------------------

create table public.circle_invite_redemptions (
  invite_id uuid not null references public.circle_invites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

comment on table public.circle_invite_redemptions is
  'One row per person per invite. Inserted only by redeem_invite.';

alter table public.circle_invite_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- New public tables are granted to anon and authenticated by default on
-- Supabase. Take that back, then grant the narrow rights below.

revoke all on table public.circles from public, anon, authenticated;
revoke all on table public.circle_members from public, anon, authenticated;
revoke all on table public.circle_invites from public, anon, authenticated;
revoke all on table public.circle_invite_redemptions from public, anon, authenticated;

grant select on table public.circles to authenticated;
grant update (name) on table public.circles to authenticated;

grant select on table public.circle_members to authenticated;
grant update (left_at, muted_until) on table public.circle_members to authenticated;

-- token_hash is intentionally absent. A member can see that a link exists.
grant select (
  id,
  circle_id,
  created_by,
  created_at,
  expires_at,
  max_uses,
  use_count,
  revoked_at
) on table public.circle_invites to authenticated;

grant select on table public.circle_invite_redemptions to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not in the Data API)
-- ---------------------------------------------------------------------------

create function private.hash_invite_token(raw_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

revoke all on function private.hash_invite_token(text) from public, anon, authenticated;

-- The plan's is_active_member(). security definer so policies on
-- circle_members can call it without recursing through their own RLS.
-- search_path is empty; every reference is schema-qualified. The plan shows
-- this in public with search_path = public. It lives here so PostgREST does
-- not expose it.
create function private.is_active_member(c uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_members
    where circle_id = c
      and user_id = (select auth.uid())
      and left_at is null
  );
$$;

revoke all on function private.is_active_member(uuid) from public, anon, authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;

comment on function private.is_active_member(uuid) is
  'True when auth.uid() has a circle_members row in this circle with left_at null.';

-- pending < 2 active members, active at 2+, archived at 0.
create function private.refresh_circle_status(target uuid)
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

  -- The guard trigger rejects a status write unless this flag is set.
  perform pg_catalog.set_config('hsummer.allow_status', '1', true);

  update public.circles
  set status = next_status
  where id = target
    and status is distinct from next_status;
end;
$$;

revoke all on function private.refresh_circle_status(uuid) from public, anon, authenticated;

create function private.circles_guard_update()
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

revoke all on function private.circles_guard_update() from public, anon, authenticated;

create trigger circles_guard_update
  before update on public.circles
  for each row
  execute function private.circles_guard_update();

create function private.circle_members_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.circle_id is distinct from old.circle_id
     or new.user_id is distinct from old.user_id
     or new.joined_at is distinct from old.joined_at then
    raise exception 'membership identity cannot change';
  end if;

  -- Coming back is a new redemption, not a client update. redeem_invite
  -- sets this flag for that one statement.
  if old.left_at is not null
     and new.left_at is null
     and pg_catalog.current_setting('hsummer.allow_rejoin', true)
       is distinct from '1' then
    raise exception 'rejoin goes through the invite';
  end if;

  return new;
end;
$$;

revoke all on function private.circle_members_guard_update() from public, anon, authenticated;

create trigger circle_members_guard_update
  before update on public.circle_members
  for each row
  execute function private.circle_members_guard_update();

create function private.circle_members_refresh_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_circle_status(old.circle_id);
    return old;
  end if;

  perform private.refresh_circle_status(new.circle_id);
  return new;
end;
$$;

revoke all on function private.circle_members_refresh_status() from public, anon, authenticated;

create trigger circle_members_refresh_status
  after insert or update or delete on public.circle_members
  for each row
  execute function private.circle_members_refresh_status();

-- Week 2 left this owner-only. Co-members can now read a profile when they
-- share an active circle. security definer so circle_members RLS cannot hide
-- the rows this join needs. It does not read account_private or auth.users.
-- Profile UPDATE does not call this function.
create or replace function private.can_read_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select profile_id is not null
     and (
       profile_id = (select auth.uid())
       or exists (
         select 1
         from public.circle_members me
         join public.circle_members them
           on them.circle_id = me.circle_id
         where me.user_id = (select auth.uid())
           and me.left_at is null
           and them.user_id = profile_id
           and them.left_at is null
       )
     );
$$;

comment on function private.can_read_profile(uuid) is
  'Owner, or someone who shares an active circle. account_private is never included.';

revoke all on function private.can_read_profile(uuid) from public, anon, authenticated;
grant execute on function private.can_read_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
--
-- Active member means private.is_active_member. The type column is not read.

create policy circles_select_member
  on public.circles
  for select
  to authenticated
  using (private.is_active_member(id));

create policy circles_update_name
  on public.circles
  for update
  to authenticated
  using (private.is_active_member(id))
  with check (private.is_active_member(id));

comment on policy circles_select_member on public.circles is
  'Active members only. There is no insert policy; create_circle inserts.';

comment on policy circles_update_name on public.circles is
  'Active members may rename. Grants allow the name column only. Status stays with the membership trigger.';

create policy circle_members_select_member
  on public.circle_members
  for select
  to authenticated
  using (private.is_active_member(circle_id));

create policy circle_members_update_own
  on public.circle_members
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on policy circle_members_select_member on public.circle_members is
  'Active members can see who is in the circle, including people who have left. A person who left fails is_active_member and sees nothing.';

comment on policy circle_members_update_own on public.circle_members is
  'You may set your own left_at or muted_until. Inserts are the redemption function. You cannot clear left_at.';

create policy circle_invites_select_member
  on public.circle_invites
  for select
  to authenticated
  using (private.is_active_member(circle_id));

comment on policy circle_invites_select_member on public.circle_invites is
  'Active members can see expiry and use counts. The token hash is not granted. Clients do not look up a token; redeem_invite does.';

create policy circle_invite_redemptions_select_member
  on public.circle_invite_redemptions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.circle_invites as invites
      where invites.id = invite_id
        and private.is_active_member(invites.circle_id)
    )
  );

comment on policy circle_invite_redemptions_select_member
  on public.circle_invite_redemptions is
  'Active members of that circle. Inserts are the redemption function.';

-- ---------------------------------------------------------------------------
-- Rate limit ledger
-- ---------------------------------------------------------------------------
--
-- One row per redeem attempt. It lives in private so PostgREST cannot read
-- it. redeem_invite inserts the row and then returns, including on failure,
-- so the count survives. 8 attempts per user and 20 per IP hash, each inside
-- 15 minutes. Week 5 replaces this with Upstash for pings and invite creation.

create table private.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  ip_hash text,
  attempted_at timestamptz not null default now()
);

create index join_attempts_user_time_idx
  on private.join_attempts (user_id, attempted_at);

create index join_attempts_ip_time_idx
  on private.join_attempts (ip_hash, attempted_at);

revoke all on table private.join_attempts from public, anon, authenticated;

comment on table private.join_attempts is
  'Redeem attempts for the week 3 rate limit. Not exposed through the Data API.';

-- ---------------------------------------------------------------------------
-- create_circle
-- ---------------------------------------------------------------------------

create function public.create_circle(circle_name text, circle_type text)
returns table (
  circle_id uuid,
  invite_id uuid,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
  cleaned text;
  new_circle uuid;
  new_invite uuid;
  raw_token text;
  new_expires timestamptz;
  new_max integer;
begin
  if actor is null then
    raise exception 'hsummer_unauthenticated';
  end if;

  if circle_type not in ('couple', 'group', 'family', 'friends') then
    raise exception 'hsummer_bad_type';
  end if;

  cleaned := nullif(pg_catalog.btrim(coalesce(circle_name, '')), '');
  if cleaned is not null and (
    pg_catalog.char_length(cleaned) > 80
    or pg_catalog.strpos(cleaned, '@') > 0
  ) then
    raise exception 'hsummer_bad_name';
  end if;

  -- Couple links are single-use. Other types stay open until they expire.
  -- This is an invite default, not an RLS check.
  new_max := case when circle_type = 'couple' then 1 else null end;
  new_expires := pg_catalog.now() + interval '7 days';
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_circle := pg_catalog.gen_random_uuid();

  insert into public.circles (id, name, circle_type, created_by, status)
  values (new_circle, cleaned, circle_type, actor, 'pending');

  insert into public.circle_members (circle_id, user_id)
  values (new_circle, actor);

  insert into public.circle_invites (
    circle_id,
    token_hash,
    created_by,
    expires_at,
    max_uses
  )
  values (
    new_circle,
    private.hash_invite_token(raw_token),
    actor,
    new_expires,
    new_max
  )
  returning id into new_invite;

  return query
  select new_circle, new_invite, raw_token, new_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- preview_invite
-- ---------------------------------------------------------------------------
--
-- Signed-in preview of a link before the person confirms. Does not join and
-- does not count as a redemption attempt.

create function public.preview_invite(raw_token text)
returns table (
  circle_id uuid,
  circle_name text,
  circle_type text,
  invite_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
  found_invite public.circle_invites%rowtype;
  found_circle public.circles%rowtype;
  active_count integer;
begin
  if actor is null then
    raise exception 'hsummer_unauthenticated';
  end if;

  if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::text, null::text, 'missing'::text;
    return;
  end if;

  select *
    into found_invite
  from public.circle_invites
  where token_hash = private.hash_invite_token(raw_token);

  if not found then
    return query select null::uuid, null::text, null::text, 'missing'::text;
    return;
  end if;

  select *
    into found_circle
  from public.circles
  where id = found_invite.circle_id;

  if found_invite.revoked_at is not null then
    return query
    select found_circle.id, found_circle.name, found_circle.circle_type, 'revoked'::text;
    return;
  end if;

  if found_invite.expires_at <= pg_catalog.now() then
    return query
    select found_circle.id, found_circle.name, found_circle.circle_type, 'expired'::text;
    return;
  end if;

  if exists (
    select 1
    from public.circle_members
    where circle_id = found_circle.id
      and user_id = actor
      and left_at is null
  ) then
    return query
    select found_circle.id, found_circle.name, found_circle.circle_type, 'already_member'::text;
    return;
  end if;

  select count(*)::integer
    into active_count
  from public.circle_members
  where circle_id = found_circle.id
    and left_at is null;

  if (
    found_circle.circle_type = 'couple' and active_count >= 2
  ) or (
    found_invite.max_uses is not null
    and found_invite.use_count >= found_invite.max_uses
  ) then
    return query
    select found_circle.id, found_circle.name, found_circle.circle_type, 'full'::text;
    return;
  end if;

  return query
  select found_circle.id, found_circle.name, found_circle.circle_type, 'ready'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_invite
-- ---------------------------------------------------------------------------
--
-- One transaction: record the attempt, lock the circle, lock the invite,
-- reject revoked / expired / full links, add the member, write the
-- redemption, increment use_count. Returning (instead of raising) commits
-- the attempt row so the rate limit cannot be rolled back by the error.

create function public.redeem_invite(raw_token text, ip_hash text)
returns table (
  invite_state text,
  circle_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
  bucket text;
  user_hits integer;
  ip_hits integer;
  found_invite public.circle_invites%rowtype;
  found_circle public.circles%rowtype;
  cid uuid;
  active_count integer;
  existing_left timestamptz;
  member_found boolean;
begin
  if actor is null then
    raise exception 'hsummer_unauthenticated';
  end if;

  if ip_hash is null
     or ip_hash !~ '^[0-9a-f]{64}$' then
    bucket := 'missing';
  else
    bucket := ip_hash;
  end if;

  delete from private.join_attempts
  where attempted_at < pg_catalog.now() - interval '1 day';

  insert into private.join_attempts (user_id, ip_hash)
  values (actor, bucket);

  select count(*)::integer
    into user_hits
  from private.join_attempts
  where user_id = actor
    and attempted_at > pg_catalog.now() - interval '15 minutes';

  select count(*)::integer
    into ip_hits
  from private.join_attempts
  where ip_hash = bucket
    and attempted_at > pg_catalog.now() - interval '15 minutes';

  if user_hits > 8 or ip_hits > 20 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;

  if raw_token is null or raw_token !~ '^[0-9a-f]{64}$' then
    return query select 'missing'::text, null::uuid;
    return;
  end if;

  select circle_id
    into cid
  from public.circle_invites
  where token_hash = private.hash_invite_token(raw_token);

  if not found then
    return query select 'missing'::text, null::uuid;
    return;
  end if;

  -- Circle first, then the invite, matching regenerate_invite.
  select *
    into found_circle
  from public.circles
  where id = cid
  for update;

  select *
    into found_invite
  from public.circle_invites
  where token_hash = private.hash_invite_token(raw_token)
  for update;

  if not found then
    return query select 'missing'::text, null::uuid;
    return;
  end if;

  if found_invite.revoked_at is not null then
    return query select 'revoked'::text, null::uuid;
    return;
  end if;

  if found_invite.expires_at <= pg_catalog.now() then
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  select left_at
    into existing_left
  from public.circle_members
  where circle_id = found_circle.id
    and user_id = actor;

  member_found := found;

  if member_found then
    if existing_left is null then
      return query select 'already_member'::text, found_circle.id;
      return;
    end if;

    -- A person who left may come back through a link that still has room.
    -- They are not a new seat, so use_count stays put. The guard trigger
    -- blocks everyone else from clearing left_at.
    perform pg_catalog.set_config('hsummer.allow_rejoin', '1', true);

    update public.circle_members
    set left_at = null
    where circle_id = found_circle.id
      and user_id = actor;

    insert into public.circle_invite_redemptions (invite_id, user_id)
    values (found_invite.id, actor)
    on conflict (invite_id, user_id) do nothing;

    return query select 'joined'::text, found_circle.id;
    return;
  end if;

  select count(*)::integer
    into active_count
  from public.circle_members
  where circle_id = found_circle.id
    and left_at is null;

  -- Couple capacity is the backstop when someone regenerates a link after
  -- the circle is already full. max_uses covers "the same link".
  if (
    found_circle.circle_type = 'couple' and active_count >= 2
  ) or (
    found_invite.max_uses is not null
    and found_invite.use_count >= found_invite.max_uses
  ) then
    return query select 'full'::text, null::uuid;
    return;
  end if;

  insert into public.circle_members (circle_id, user_id)
  values (found_circle.id, actor);

  insert into public.circle_invite_redemptions (invite_id, user_id)
  values (found_invite.id, actor);

  update public.circle_invites
  set use_count = use_count + 1
  where id = found_invite.id;

  return query select 'joined'::text, found_circle.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- regenerate_invite
-- ---------------------------------------------------------------------------

create function public.regenerate_invite(target_circle uuid)
returns table (
  invite_id uuid,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := (select auth.uid());
  found_type text;
  new_invite uuid;
  raw_token text;
  new_expires timestamptz;
  new_max integer;
begin
  if actor is null then
    raise exception 'hsummer_unauthenticated';
  end if;

  if not private.is_active_member(target_circle) then
    raise exception 'hsummer_not_member';
  end if;

  select circle_type
    into found_type
  from public.circles
  where id = target_circle
  for update;

  if not found then
    raise exception 'hsummer_not_member';
  end if;

  update public.circle_invites
  set revoked_at = pg_catalog.now()
  where circle_id = target_circle
    and revoked_at is null;

  new_max := case when found_type = 'couple' then 1 else null end;
  new_expires := pg_catalog.now() + interval '7 days';
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.circle_invites (
    circle_id,
    token_hash,
    created_by,
    expires_at,
    max_uses
  )
  values (
    target_circle,
    private.hash_invite_token(raw_token),
    actor,
    new_expires,
    new_max
  )
  returning id into new_invite;

  return query select new_invite, raw_token, new_expires;
end;
$$;

revoke all on function public.create_circle(text, text) from public, anon;
revoke all on function public.preview_invite(text) from public, anon;
revoke all on function public.redeem_invite(text, text) from public, anon;
revoke all on function public.regenerate_invite(uuid) from public, anon;

grant execute on function public.create_circle(text, text) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.redeem_invite(text, text) to authenticated;
grant execute on function public.regenerate_invite(uuid) to authenticated;

comment on function public.create_circle(text, text) is
  'Creates a pending circle, adds the caller, and returns a new invite token once.';

comment on function public.preview_invite(text) is
  'Describes a link without joining. States: missing, revoked, expired, full, already_member, ready.';

comment on function public.redeem_invite(text, text) is
  'Joins a circle from an invite token. Rate-limited per user (8 / 15 min) and per IP hash (20 / 15 min).';

comment on function public.regenerate_invite(uuid) is
  'Revokes the live invite and returns a new token. The old link stops working.';
