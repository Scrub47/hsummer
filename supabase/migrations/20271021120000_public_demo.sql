-- Public demo content.
--
-- Replaces seed_demo_circle with a fuller fictional couple: letters (one of
-- them still scheduled), a countdown, a photo strip, a bucket list, Thinking
-- of You pings, and memory-wall photos. The pictures are uploaded by the
-- app from public/demo-media. They are drawings, not photographs of people.
--
-- This file does not widen RLS. Alex and Jordan stay ordinary members of
-- the one demo circle. private.circle_members_demo_guard still refuses a
-- real account joining that circle and a demo account joining any other.
-- The write triggers from 20270125120000_launch_readiness.sql still raise
-- hsummer_demo_readonly unless hsummer.demo_seed is 1, and only this
-- function sets that. Authenticated callers cannot execute the function.
--
-- The timestamp is the day after 20271020120000_feedback.sql. The repo's
-- migration clock is ahead of the calendar, and a file dated today would
-- run before the tables this function updates.

create or replace function public.seed_demo_circle(photo_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alex uuid := 'a11ce000-0000-4000-8000-0000000000a1';
  jordan uuid := 'a11ce000-0000-4000-8000-0000000000b2';
  demo_circle uuid := 'a11ce000-0000-4000-8000-0000000000c3';
  kitchen_id uuid := 'a11ce000-0000-4000-8000-0000000000d4';
  ramen_id uuid := 'a11ce000-0000-4000-8000-0000000000d5';
  train_id uuid := 'a11ce000-0000-4000-8000-0000000000d6';
  opened_letter uuid := 'a11ce000-0000-4000-8000-0000000000e5';
  scheduled_letter uuid := 'a11ce000-0000-4000-8000-0000000000e6';
  sealed_letter uuid := 'a11ce000-0000-4000-8000-0000000000e7';
  reply_letter uuid := 'a11ce000-0000-4000-8000-0000000000e8';
  hit_checkpoint uuid := 'a11ce000-0000-4000-8000-0000000000c7';
  next_checkpoint uuid := 'a11ce000-0000-4000-8000-0000000000c8';
  alex_avatar text := alex::text || '/a11ce000-0000-4000-8000-0000000000aa.png';
  jordan_avatar text := jordan::text || '/a11ce000-0000-4000-8000-0000000000bb.png';
  kitchen_path text;
  ramen_path text;
  train_path text;
  booth jsonb;
  booth_paths jsonb;
  files jsonb := '[]'::jsonb;
  shot_index integer;
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
    avatar_path = case
      when profile.id = alex then alex_avatar
      else jordan_avatar
    end
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
  set
    label = 'Next visit',
    target_date = date '2027-06-12'
  where countdown.circle_id = demo_circle;

  insert into public.checkpoints (
    id,
    circle_id,
    countdown_id,
    label,
    date,
    trigger
  )
  select
    hit_checkpoint,
    demo_circle,
    countdown.id,
    'Booked the visit',
    date '2026-08-02',
    'manual'
  from public.countdowns as countdown
  where countdown.circle_id = demo_circle
  limit 1;

  insert into public.checkpoints (
    id,
    circle_id,
    countdown_id,
    label,
    date,
    trigger
  )
  select
    next_checkpoint,
    demo_circle,
    countdown.id,
    'Pick the weekend',
    date '2027-03-14',
    'manual'
  from public.countdowns as countdown
  where countdown.circle_id = demo_circle
  limit 1;

  perform public.hit_checkpoint(hit_checkpoint);

  insert into public.bucket_items (
    circle_id, title, category, status, notes
  )
  values (
    demo_circle,
    'Try the ramen shop on Pine',
    'restaurant',
    'idea',
    'A fictional plan for the demo. Not a real reservation.'
  );

  insert into public.bucket_items (
    circle_id, title, category, status, planned_date, notes
  )
  values (
    demo_circle,
    'Watch the same film on a call',
    'movie',
    'planned',
    date '2026-11-08',
    'Fictional. They press play at the same minute.'
  );

  insert into public.bucket_items (
    circle_id, title, category, status, notes
  )
  values (
    demo_circle,
    'Walk the waterfront',
    'activity',
    'done',
    'A made-up afternoon. Nothing here is a real place.'
  );

  insert into public.bucket_items (
    circle_id, title, category, status, notes
  )
  values (
    demo_circle,
    'Picnic with the good peaches',
    'date-idea',
    'idea',
    'Fictional. The peaches are not a recommendation.'
  );

  insert into public.bucket_items (
    circle_id, title, category, status, notes
  )
  values (
    demo_circle,
    'Cook the same dinner on a call',
    'ldr-idea',
    'planned',
    'Fictional. Two kitchens, one recipe.'
  );

  insert into public.current_moods (user_id, circle_id, emoji)
  values (alex, demo_circle, '🥰');

  kitchen_path := demo_circle::text || '/' || kitchen_id::text || '.png';
  ramen_path := demo_circle::text || '/' || ramen_id::text || '.png';
  train_path := demo_circle::text || '/' || train_id::text || '.png';

  insert into public.memories (
    id, circle_id, created_by, kind, body, photo_path, photo_bytes,
    tags, visibility, occurred_on
  )
  values
    (
      kitchen_id, demo_circle, alex, 'photo',
      'Kitchen light. A drawing for the demo, not a photograph.',
      kitchen_path, photo_bytes, array['home']::text[], 'circle',
      current_date - 2
    ),
    (
      ramen_id, demo_circle, alex, 'photo',
      'The ramen we keep meaning to try. Fictional.',
      ramen_path, photo_bytes, array['food']::text[], 'circle',
      current_date - 6
    ),
    (
      train_id, demo_circle, alex, 'photo',
      'Night train between the two cities. Drawn, not photographed.',
      train_path, photo_bytes, array['travel']::text[], 'circle',
      current_date - 20
    );

  insert into public.memories (
    circle_id, created_by, kind, body, tags, visibility, occurred_on
  )
  values (
    demo_circle,
    alex,
    'note',
    'First week in the new city. The light in the kitchen is nice. This note is fictional.',
    array['week-one']::text[],
    'circle',
    current_date - 12
  );

  insert into public.letters (
    id, circle_id, from_user_id, to_user_id, category, title, body, design
  )
  values (
    opened_letter,
    demo_circle,
    alex,
    jordan,
    'when-you-miss-me',
    'For a long week',
    'The train was late and I thought of you. This letter is fictional, for the demo circle only.',
    'minimal'
  );

  insert into public.letters (
    id, circle_id, from_user_id, to_user_id, category, title, body, design, scheduled_for
  )
  values (
    scheduled_letter,
    demo_circle,
    alex,
    jordan,
    'feeling-lonely',
    'Read this Friday',
    'This one is waiting. It is fictional, for the demo circle only, and it arrives later on purpose.',
    'kawaii',
    pg_catalog.now() + interval '21 days'
  );

  insert into public.pings (circle_id, from_user_id, to_user_id, ping_type)
  values (demo_circle, alex, jordan, 'thinking-of-you');

  booth := public.save_solo_booth(
    demo_circle,
    'kawaii',
    '4-cut',
    'warm',
    'A made-up strip. These frames are drawings, not photographs.',
    array[photo_bytes, photo_bytes, photo_bytes, photo_bytes]
  );

  perform private.act_as(jordan);

  insert into public.current_moods (user_id, circle_id, emoji)
  values (jordan, demo_circle, '😌');

  insert into public.memories (
    circle_id, created_by, kind, body, tags, visibility, occurred_on
  )
  values (
    demo_circle,
    jordan,
    'note',
    'Left the porch light on. Also fictional.',
    array['home']::text[],
    'circle',
    current_date - 1
  );

  insert into public.letters (
    id, circle_id, from_user_id, to_user_id, category, title, body, design
  )
  values (
    sealed_letter,
    demo_circle,
    jordan,
    alex,
    'need-motivation',
    'When the week feels long',
    'The seal is still on this one. The words are fictional, for the demo only.',
    'retro-film'
  );

  insert into public.letters (
    id, circle_id, from_user_id, to_user_id, category, title, body, design
  )
  values (
    reply_letter,
    demo_circle,
    jordan,
    alex,
    'distance-is-too-hard',
    'The kitchen light',
    'I read your letter on the train. None of this happened. It is sample text for the demo.',
    'minimal'
  );

  insert into public.pings (
    circle_id, from_user_id, to_user_id, ping_type, secret_variant
  )
  values
    (demo_circle, jordan, alex, 'thinking-of-you', false),
    (demo_circle, jordan, alex, 'thinking-of-you', true);

  perform public.open_letter(opened_letter);

  perform private.act_as(alex);

  perform public.open_letter(reply_letter);

  perform private.act_as(null);
  perform pg_catalog.set_config('hsummer.demo_seed', '', true);

  booth_paths := coalesce(booth -> 'paths', '[]'::jsonb);
  files := jsonb_build_array(
    jsonb_build_object('bucket', 'memories', 'path', kitchen_path, 'name', 'kitchen'),
    jsonb_build_object('bucket', 'memories', 'path', ramen_path, 'name', 'ramen'),
    jsonb_build_object('bucket', 'memories', 'path', train_path, 'name', 'train'),
    jsonb_build_object('bucket', 'avatars', 'path', alex_avatar, 'name', 'avatar-alex'),
    jsonb_build_object('bucket', 'avatars', 'path', jordan_avatar, 'name', 'avatar-jordan')
  );

  if pg_catalog.jsonb_typeof(booth_paths) = 'array' then
    for shot_index in 0 .. pg_catalog.jsonb_array_length(booth_paths) - 1 loop
      files := files || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'bucket', 'memories',
          'path', booth_paths ->> shot_index,
          'name', 'booth-' || shot_index::text
        )
      );
    end loop;
  end if;

  return pg_catalog.jsonb_build_object(
    'circleId', demo_circle,
    'photoPath', kitchen_path,
    'boothPaths', booth_paths,
    'files', files
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
  'Rebuilds the one demo couple from fictional rows and drawings. Deletes only that circle''s content. service_role only. The two auth users must already exist at the fixed ids. A signed-in caller is refused, so a demo session cannot rebuild or read anyone else''s circle through this function.';
