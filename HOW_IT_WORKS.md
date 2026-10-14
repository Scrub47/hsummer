# How Hsummer works

This is the map of the repository as it stands after Pass the Booth. It is written for reading the code, not as a changelog.

Hsummer is a private space shared by a Circle: a couple, a few friends, or a family. Profiles came first. Who may read one is a single function, and that function now includes people who share an active circle. Circles, memberships, invite links, pings, a shared bucket list, a current mood per person, and a memory wall are in the database. A 1:1 ping is readable only by the sender and the recipient. A bucket item is readable and editable by every active member of that circle. A mood is readable by active members and writable only by the person it belongs to. A memory is readable by every active member when its visibility is the whole circle, and only by the author plus the people they picked when visibility is selected. A letter is readable by the sender, and by the recipient only after it is delivered. Opening it adds one memory that only those two can see. A couple circle also has one Still Us countdown. Hitting a checkpoint adds one memory the whole circle can see. The photo booth draws a strip on the phone. Solo adds one memory the whole circle can see only when you save. Pass the Booth adds that memory only after both people have filled their frames.

## Shape of the app

```
Browser
  landing page, sign-in form, home, profile, circles, join link
  service worker (public/sw.js)  ← push events
        │
        ▼
Next.js (App Router) on Vercel
  src/proxy.ts                     refresh the session cookie
  src/app/auth/callback            finish Google / magic link
  src/app/profile/actions.ts       save the signed-in user's profile
  src/app/circles/actions.ts       create a circle, rename, new invite
  src/app/circles/bucket-actions.ts  add, edit, remove a bucket item
  src/app/circles/mood-actions.ts    set or clear your current mood
  src/app/circles/memory-actions.ts  add or remove a memory; strip photo EXIF
  src/app/circles/booth-actions.ts   save a Solo strip, or pass frames to your partner
  src/app/circles/letter-actions.ts  write, schedule, cancel, or open a letter
  src/app/circles/countdown-actions.ts  reunion date, checkpoints, mark hit
  src/app/join/actions.ts          redeem an invite link
  src/app/api/push/*               save a device, send a test push
  src/app/api/pings                Thinking of You, then push the partner
  src/app/api/letters/deliver      QStash callback for a scheduled letter
        │
        ▼
Supabase
  Auth (auth.users holds the email)
  Postgres: profiles, account_private, circles, members, invites,
            pings, bucket_items, current_moods, memories,
            memory_viewers, letters, letter_categories,
            countdowns, checkpoints, push_subscriptions,
            booth_sessions, booth_contributors, booth_shots
  Realtime: bucket_items, current_moods, memories, letters,
            countdowns, and checkpoints
  Storage: private buckets "avatars", "memories", and "backups"
  Row Level Security: circle rows for active members; a 1:1 ping
                      or letter only for its sender and recipient
```

Next.js serves both the UI and the server routes, so there is one TypeScript codebase. Supabase holds the data and the login session. Vercel hosts the Next.js app. The browser's push service (Apple, Google, Mozilla) delivers notifications; our server only talks to the endpoint the browser gave us.

## Request path

1. Every document and API request goes through `src/proxy.ts` (this used to be called middleware). The matcher skips images, the service worker, and Next's own static files.
2. `src/lib/supabase/proxy.ts` builds a server Supabase client that reads and writes cookies on that request. It calls `auth.getClaims()`, which verifies the JWT and refreshes it when it is about to expire. The same function sets the cookie flags (`SameSite=Lax`, `Secure` only when the request is https, `HttpOnly` off because the browser client has to read the token) and a per-request Content-Security-Policy nonce. `src/app/layout.tsx` waits on `connection()` so Next can stamp that nonce.
3. Server Components cannot write cookies. If the proxy did not refresh the token, the next request would present a used refresh token and Supabase would sign the user out. That is why the refresh lives in the proxy even though each page also checks the user.
4. The proxy redirects `/home`, `/profile`, and `/circles` to `/sign-in` when there is no verified user, and it keeps the path in `next` so sign-in can come back. `/join/...` stays public: the page itself asks the person to sign in, then confirm. That redirect is a convenience. The pages and the push routes call `getClaims()` again. Do not trust `getSession()` on the server: it reads the cookie without checking the signature.

If the Supabase URL or key is missing, or still the placeholder from `.env.example`, the proxy skips the client entirely. Public pages render, including an invite link that does not look like a token. `/home`, `/profile`, and `/circles` redirect to sign-in. The sign-in form explains that the project is not configured.

## Auth

Sign-in is passwordless in the product. Google and the magic link are the two buttons. The app does not collect or hash a password. Accounts created through the app never get one, because sign-up and sign-in only call those two actions. Magic link is part of Supabase's Email provider, so that provider stays enabled. The local Supabase config still allows a password because the RLS suite creates users and signs them in that way.

The form used to call `signInWithOtp` and `signInWithOAuth` from the browser. It now posts to `src/app/sign-in/actions.ts`.

- **Google** calls `signInWithOAuth` with `skipBrowserRedirect`. The action checks the returned URL is on the Supabase project's `/auth/v1/` path, then the browser navigates there. Supabase sends the person to Google and back to `/auth/callback?code=`.
- **Magic link** calls `signInWithOtp`. The email either comes back with a `code` (same browser, PKCE cookie) or a `token_hash` (works across devices, after the email template change in the README). `src/app/auth/callback/route.ts` checks the query with zod, then handles both. The magic-link call sends the browser's IANA timezone in user metadata so the signup trigger can store it.

Before either call, the action counts the try. The caps are 5 magic links per IP hash, 3 per email hash, and 10 Google starts per IP hash, all inside 15 minutes. The bucket is a hash (`hsummer-auth-email-v1:` or the existing IP hash), not the address. Upstash is used when it is configured and answers. Otherwise `consume_auth_attempt` writes `private.auth_attempts`. In production, if neither limiter can answer, the action refuses. A person who calls the Auth API directly never hits this function. Supabase's own auth rate limit, and Turnstile when it is turned on, are what cover that path.

Turnstile is off unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set to a real site key. The widget then has to render before either button calls the action. Magic link forwards the token to Supabase, and Auth checks it on `POST /otp` only after captcha is enabled in the dashboard with the matching secret. Auth does not check captcha on `GET /authorize`, and a Turnstile token can be used once, so Google is checked by `src/lib/auth/turnstile.ts` with `TURNSTILE_SECRET_KEY` (a server secret, also pasted into the Supabase dashboard). With the site key empty, the sign-in page looks as it did, and the unconfigured smoke test still gets the "isn't configured" alert without calling the action.

`getSession()` in `src/lib/supabase/session.ts` is the server helper, and the name is the confusing part. The body calls `getClaims()`, which checks the JWT. Do not replace that with `auth.getSession()` on the server. The browser's Realtime hook does call `getSession()`, and that one only supplies the access token to the socket.

The callback only redirects to a path on our own origin. `safeNextPath` rejects `https://somewhere-else` and `//somewhere-else`, so a link cannot bounce a signed-in browser to another site.

Sign-out is a POST form to `/auth/sign-out`. A GET would let any page on the internet sign the user out with an image tag.

The browser client (`src/lib/supabase/client.ts`) and the server client (`src/lib/supabase/server.ts`) are separate on purpose. The browser client is a singleton. The server client is created per request because it has to see that request's cookies. `setAll` in the server client is wrapped in try/catch: from a Server Component, writing cookies throws, and the proxy has already done the write.

## Profiles, and why email is not a column

`auth.users` is Supabase's account table. The email lives there and is not exposed through the Data API.

`public.profiles` is what other people will eventually be allowed to see: display name, an optional avatar, and an IANA timezone. A trigger, `handle_new_user`, inserts that row when Auth creates a user. The function is `security definer` with an empty `search_path`. It runs as the migration owner, so it can insert even though clients have no insert policy. If the function raised, signup would fail, so a missing or weird name becomes "New member" and a bad timezone becomes `UTC`.

The trigger never reads `new.email`. A name that contains `@` is thrown away. The table constraint repeats that rule so a later update cannot store an address either.

`public.account_private` is the owner-only companion: `age_confirmed_at` (null until a later week asks the person to confirm they are 13+) and `notification_prefs`. The same trigger inserts that row. People who signed up before the week 2 migration get a row from a backfill in that migration. There is no insert or delete policy. Clients may update only `age_confirmed_at` and `notification_prefs`, not the user id. Circle members must never gain a policy on this table. Email is not a column here either.

Who can read a profile is `private.can_read_profile(profile_id)`. The function lives in the `private` schema, which is not in the Data API. It is true for the owner, and for anyone who shares an active circle (both `circle_members` rows have `left_at` null). It is `security definer` so the join can see those rows even though `circle_members` has its own RLS. It does not read `account_private` or `auth.users`. The policies on `profiles` and on avatar SELECT already call this function, so they did not change:

```sql
id = auth.uid()
or exists (
  select 1
  from circle_members me
  join circle_members them on them.circle_id = me.circle_id
  where me.user_id = auth.uid() and me.left_at is null
    and them.user_id = profiles.id and them.left_at is null
)
```

The update policy on `profiles` stays `id = auth.uid()` and must not start calling `can_read_profile`. Co-members can read a name and a photo. Changing them stays with the owner. A before-update trigger rejects changes to `id` and `created_at`, and rejects pointing `avatar_path` at a new `https://` URL. The week 1 trigger may still store a Google profile photo URL at signup. That legacy value can stay until the person uploads or removes a photo. A client cannot replace it with a different URL, which would become a tracking pixel once co-members can read profiles.

`(select auth.uid())` is the form Supabase recommends. Postgres can evaluate it once per query instead of once per row.

## The profile page

`/profile` is a Server Component. It requires a verified session, loads the caller's row, and renders `ProfileForm`.

The form is a Client Component because it needs the browser timezone and `useActionState`. When the saved timezone is still `UTC` (what Google sign-in leaves behind), the field switches to `Intl.DateTimeFormat().resolvedOptions().timeZone` after mount. That detection cannot run during server render: the server's zone is not the person's. Saving writes the value through the server action.

`updateProfile` in `src/app/profile/actions.ts` checks the session again. The user id comes from the JWT, not from the form. Display name, timezone, and the photo are checked in `src/lib/profile/fields.ts` before any request: the name is 1–80 characters and cannot contain `@`, the timezone must match the database's IANA pattern and be a real zone, and the photo's bytes must be JPEG, PNG, or WebP up to 2 MB. The filename the browser sends is ignored. A HEIC or a JPEG is drawn to a JPEG in the browser before that check, so an iPhone photo is upright and under 2 MB. `src/lib/profile/stored-avatar.ts` then removes EXIF and text chunks. The profile form does not import that file. The object name is `{user id}/{uuid}.jpg|png|webp`.

The action uploads with the user's Supabase client, so Storage RLS applies, then updates `profiles`. If the update fails, it deletes the object it just uploaded. Replacing a photo deletes the previous object when that previous value is an object path in the caller's folder. Legacy `https://` values are not sent to Storage. `removeProfilePhoto` is a separate form so pressing Enter in the name field saves, and does not remove the picture.

The page does not show the email address. It also does not read `account_private`. That table stays owner-only after circles exist. Co-members can read a name, a photo, and a timezone, and nothing else on the account.

Avatar images are a plain `<img>`, not `next/image`. The optimizer would fetch and cache the signed URL.

## Avatars in Storage

The week 2 migration inserts a bucket named `avatars` with `public = false`, a 2 MB limit, and the three image types. Policies on `storage.objects`:

| Policy                   | Who                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `avatars_select_visible` | `can_read_profile` of the folder name (the user id). Week 3 widens this automatically when the function grows. |
| `avatars_insert_own`     | The folder is `auth.uid()` and the name matches `{uid}/{uuid}.jpg\|png\|webp`.                                 |
| `avatars_delete_own`     | The folder is `auth.uid()`.                                                                                    |

There is no update policy. A new photo is a new object; the old one is deleted. Insert and delete must stay owner-only when select starts allowing co-members.

`loadOwnProfile` asks Storage for a signed URL that lasts one hour. Creating that URL requires the select policy, so the user's own JWT is enough. The service-role key is not used. A path that is not the caller's object, and not an `https://` URL, is not turned into an image address.

Server Actions default to a 1 MB body. `next.config.ts` raises that to 3 MB so a 2 MB photo plus the multipart wrapper fits.

## Circles and invite links

A circle has a type (`couple`, `group`, `family`, `friends`), an optional name, and a status. Status is not written by the app. A trigger counts `circle_members` rows with `left_at` null: 0 is `archived`, 1 is `pending`, 2 or more is `active`. The create form only offers a couple. The other types are accepted by `create_circle` so the RLS tests can build a 3-person circle. `circle_type` is not mentioned in any policy. It chooses the invite default (couples get `max_uses = 1`; everyone else is open until expiry) and, in the ping insert trigger only, rejects a whole-circle ping in a couple.

`private.is_active_member(circle_id)` is the plan's helper, kept in the `private` schema. It is `security definer` with an empty `search_path`. Policies on circles, members, invites, and redemptions call it. If it ran as the caller, the member policy would recurse through itself.

Clients cannot insert those rows. `create_circle`, `preview_invite`, `redeem_invite`, and `regenerate_invite` are the only writers, and they run as `security definer` after checking `auth.uid()`.

The invite token is 32 random bytes, hex encoded. The row stores `token_hash`, the SHA-256 of that string. Authenticated clients are not granted the column, so a member cannot read the hash and a client cannot search by token. `redeem_invite` hashes the token from the link. The raw value is returned once, from create or regenerate. The circle page keeps it in `localStorage` (`src/lib/circles/invite-token.ts`) so it is still there after an iPhone kills the installed app. `sessionStorage` does not survive that, and making a new link revokes the one already sent. A token an older page left in `sessionStorage` is still read. Closing the phone's share sheet does not copy the link onto the clipboard. Generating a new link sets `revoked_at` on the old row. The partial unique index allows one live link per circle.

Redeem is one transaction. It records the attempt, locks the circle, locks the invite, and then either adds a member or returns a state (`missing`, `revoked`, `expired`, `full`, `already_member`, `rate_limited`, `joined`). Returning, instead of raising, commits the attempt. A raised error would roll the counter back and the limit would not hold. The limits are 8 attempts per user and 20 per IP hash in 15 minutes. The server hashes the IP (`hsummer-join-v1:` plus the first forwarded hop) and passes the hash. The raw IP is not stored. A couple that already has two active members stays full even if someone regenerates the link. That capacity check lives in the function, not in an RLS policy.

`/join/[token]` is the link. Signed out, it asks the person to sign in and comes back via `next`. Signed in, it previews the circle name and posts to `redeem_invite`. Nothing joins them until they confirm.

While a circle is pending, its page is the invite prompt. Thinking of You is not shown there. After the second person joins, an active couple gets one button and a short list of recent pings. The button does not ask who to send to. `resolveCouplePartner` returns the only other active member, and the route refuses a group, a pending circle, and any body that includes `toUserId`.

`BROADCAST_PINGS_ENABLED` is false. A whole-circle ping is a row with `to_user_id` null. The select policy lets every active member read that shape, and the insert policy allows the null, so the RLS suite can create a 3-member group directly and prove both sides: the third member sees the null row and does not see a 1:1 row between the other two. The app never writes the null. A couple cannot write it either. The insert trigger reads `circle_type` and raises `hsummer_couple_needs_recipient`. That read stays out of the policies. `circle_type` is still only a default.

The same trigger stamps `sent_at` from the database clock and allows 10 pings per sender per 10 minutes, across every circle. An advisory lock makes two overlapping requests share one count. The route counts with `count: "exact"` and returns 429 with a plain sentence when the person is already at the cap. If that count cannot be read, the route refuses the send instead of guessing. The trigger remains the check a direct insert cannot skip.

New invite rows are capped the same way: 10 per person per 15 minutes, covering both a new circle and a regenerated link. The trigger is `private.circle_invites_guard_insert`, on `circle_invites`, so `create_circle` and `regenerate_invite` share one count. It stamps `created_at` from the database clock. Redeem still allows 8 attempts per person and 20 per IP hash inside 15 minutes. A before-insert trigger on `private.join_attempts` takes an advisory lock per user and then per IP hash, so two overlapping tries cannot both pass the count. The lock order is always user, then IP, so those two locks cannot deadlock with each other.

Upstash Redis is optional. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set, the server asks `@upstash/ratelimit` (sliding window, same numbers) before the database call and returns the same sentence on 429. A Redis error or a timeout falls through to Postgres. When the variables are empty, Postgres is the only limiter and nothing else changes. A person who calls Supabase directly never hits Upstash, which is why the SQL stays.

`secret_variant` is the `Missing<name>` easter egg. A long-press on the button, or a visually hidden control whose name is "Missing Summer", sets the flag. The button captures the pointer, so a small finger move on an iPhone does not cancel the press and send an ordinary ping instead. The recent list then says "Missing Summer". The push body is the fixed sentence "Missing you." The display name is not in the payload.

A member can set their own `left_at`. They cannot clear it; coming back is another redemption, and only `redeem_invite` is allowed to do that. The moment `left_at` is set, `is_active_member` is false, so that person gets zero rows from the circle and stops being able to read the other person's profile.

## Bucket list

`bucket_items` is one list per circle. The columns are title, category (`restaurant`, `movie`, `activity`, `date-idea`, `ldr-idea`), status (`idea`, `planned`, `done`), an optional planned date, optional notes, and an optional http(s) link. `created_by` is who added it. The insert trigger sets that to `auth.uid()`, so a client cannot name someone else. Deleting that account sets the column to null, and the page says "Former member". A person who left is no longer in the member list, so their name resolves the same way: the profile read rule no longer includes them.

`planned_date` is a Postgres `date`. The page formats it in UTC so a viewer in the US does not see the previous calendar day. `completed_at` is stamped when status becomes `done` and cleared if the item moves back to idea or planned. The client is not granted that column. Marking an item done does not add a memory. The wall is a separate list of notes and photos. `completed_at` is only the record that the bucket item was finished.

Policies call `private.is_active_member`. There is no `circle_type` in them. Select, insert, update, and delete are all allowed for every active member, including an item they did not add. An outsider and a member who has set `left_at` get zero rows. The circle page shows the list while the circle is still pending. Thinking of You stays hidden until the circle is an active couple. That matches the plan: the list works before the second person joins.

The form is a client component. Saves are server actions, so the user id comes from the verified session and `revalidatePath` redraws the page in the same response. A Supabase Realtime channel on `bucket_items`, filtered to this circle, calls `router.refresh()` for the other person's edits. The browser waits for the signed-in access token and passes it to the socket before subscribing, so row-level security can see the member. Joining first as the anonymous key would accept the channel and then drop every change. The migration adds the table to the `supabase_realtime` publication when that publication exists, and sets `replica identity full` so an update or delete still carries `circle_id` for the filter. If the publication was missing when the SQL ran, the dashboard toggle is the same change. Own saves still appear without Realtime, because the action revalidates the page.

Changing the status submits the whole edit form, so a status tap also stores notes that were already typed. Removing an item asks once in the page, then deletes. The card's React key includes `updated_at`, so a partner's save replaces a half-finished draft with the saved row.

## Current mood

`current_moods` is one row per person per circle. The primary key is `(user_id, circle_id)`, so saving again is an upsert: the same row changes emoji instead of adding a second one. The emoji has to be one of six (Good, Calm, Loved, Tired, Low, Excited). A free-text mood would be a place to hide an email address, so the check constraint is the palette and nothing else.

Select is allowed for an active member, and only while the person who set the mood is still an active member. Insert, update, and delete require `user_id = auth.uid()` as well. A co-member can read your mood and cannot write it. An outsider gets zero rows. The moment someone sets `left_at`, their mood disappears from the circle. The row stays in the table (the service role can still see it) and shows up again if they rejoin. `circle_type` is not in any of these policies.

PostgREST's upsert writes every column in the body when a row already exists, including `user_id` and `circle_id`. Those two columns are granted on update for that reason. A before-update trigger stamps `updated_at` from the database clock and raises `hsummer_mood_locked` if either id changes. `updated_at` is not granted, so a client cannot backdate the row to confuse the "when" line.

The circle page lists every member's mood and a row of buttons. Tapping one submits that emoji. The share checkbox is off. That save does not insert a ping and does not call the push sender. Home shows the same list for the active couple, and it does not have the buttons. Realtime on `current_moods` calls `router.refresh()` the same way the bucket list does, after the browser passes the signed-in access token. If Realtime is off, a reload shows the other person's mood. Own saves show up without it, because the action calls `revalidatePath`.

Checking **Also send this as a ping** still upserts the mood first. It then calls `sendThinkingOfYou` with the emoji. That function builds a `mood-share` row (`mood_emoji` set, `secret_variant` false) and inserts it with the caller's session, so the ping policies and the 10-in-10-minutes trigger still apply. Upstash, when both of its variables are set, checks the same `ping:` key before the insert. The push body stays "Thinking of you." The emoji is not a field on the notification. The recent list inside the app says "Feeling" plus the emoji. If the ping is refused (the cap, a circle that is not an active couple), the mood row is already saved and the page says so. `POST /api/pings` still rejects a body that includes a mood. The checkbox is the only way the app writes `mood-share`. A couple share goes to the partner. Picking someone in a group is later.

Clearing a mood deletes your own row. That does not send a ping.

## Memory wall

`memories` is a photo or a note on one circle. `occurred_on` is a calendar date, the same kind of value as a bucket item's planned date, and the page groups by its month in UTC so two people do not file the same day under different months. Tags are up to eight short lowercase labels. The trigger lowercases them. A tag cannot contain `@`.

`visibility` is `circle` or `selected`. Circle means every active member. Selected means the author, plus rows in `memory_viewers`. The author is not stored as a viewer. Leaving the circle (`left_at` set) removes access even if a viewer row is still there, because the select policy also requires `is_active_member`. That policy reads the memory row itself and asks `private.is_memory_viewer` about the list, so an insert that returns the new row can see it. Storage calls `private.can_read_memory`, which checks the same rule. `circle_type` is not in these policies. A co-member can read what they are allowed to see and cannot edit or delete someone else's row.

The photo object lives in a private bucket named `memories`, created by the week 8 migration. The path is `{circle id}/{memory id}.jpg|png|webp`. The insert into Storage is allowed only when a memory row already points at that path and the caller is the author, so a member cannot plant a file under someone else's id. There is no update policy. Deleting the row deletes the object in `private.memories_remove_photo`. Storage otherwise refuses a direct delete of `storage.objects`, so that trigger sets the same session flag the Storage API uses for its own delete. The public object URL is not available.

The server action sniffs the magic bytes, refuses anything that is not a JPEG, PNG, or WebP, and refuses a file over 2 MB. It then strips EXIF (JPEG APP1 and IPTC), PNG text chunks, and WebP EXIF/XMP before the upload. A file that cannot be parsed is refused, so a truncated JPEG is not stored with the metadata still attached. The browser may shrink a larger camera photo first; the server still checks the bytes it receives. `photo_bytes` is the size after that strip. Notes store 0. The sum per circle is capped at 100 MB (`104857600`). A note still saves when the photo quota is full. A second trigger on `storage.objects` applies the same cap to recorded object sizes in the memories bucket and ignores avatars and backups.

Inserts are limited to 10 per person per 10 minutes. The trigger takes an advisory lock per author, the same shape as pings. Upstash, when both of its variables are set, checks `memory:{user id}` first and returns the same sentence. A direct insert never reaches Upstash.

The page asks Storage for a signed URL that lasts five minutes (`MEMORY_SIGNED_URL_SECONDS`). Creating that URL requires the select policy, so the user's own JWT is enough. The service-role key is not used. The loader refuses a URL that is not a displayable http(s) address. An `<img>` is used on purpose: the image optimizer would fetch and cache the signed URL. After five minutes Storage rejects the link. Reloading the page asks for a new one. A member who can already see the photo can ask Storage for a longer link from their own session, because the select policy is what allows signing. The page itself always asks for five minutes.

`public.circle_memory_bytes(circle id)` returns the sum for an active member and null for anyone else, so the usage line is the whole circle and not only the photos this person can see. Realtime on `memories` refreshes the page. Adding a viewer bumps `updated_at` so that change is included.

A saved Solo strip is another kind of memory, `photo-strip`. It has no `photo_path`. The bytes that count toward the 100 MB quota are the sum of the frame JPEGs, stored on the memory as `photo_bytes`. The wall draws the strip again from those frames.

## Photo booth

Solo Booth is one phone. Capture, the theme, the filter, and Download all happen in the browser. No `booth_sessions` row exists until Save to this circle. Pass the Booth is the async mode described below. Live Together is not in this build.

The page is `/circles/[id]/booth`. It works while the circle is still pending. The preview is a `<video>` with `playsInline`, `muted`, and `autoPlay`, and the element is mirrored with CSS. `getUserMedia` is called from the Use the camera button, with `audio: false`, because the permissions policy allows `camera=(self)` and refuses the microphone. The captured frame is drawn from the video element, so it is not mirrored and text in the picture reads the right way. If permission is denied, the camera is missing, or the page is not a secure context, the message tells an iPhone user where to allow the camera for the Home Screen app and for Safari, and the library picker still works.

A strip is 600×1800. 4-cut is four frames. 2-cut is two taller ones. Kawaii and Minimal are separate theme files (`src/lib/booth/themes/kawaii.ts` and `minimal.ts`): palette, type, padding, and stickers. The layout math only reads those numbers. Filters (black and white, sepia, warm, cool, grain) run on the slot-sized frame. Grain uses the pixel index, so the same photo does not change between saves. Each frame is a JPEG at about 0.9 quality, at that slot's size, with no EXIF because it came from a canvas. The server sniffs the bytes and strips metadata again, and it refuses anything that is not a JPEG.

Save calls `save_solo_booth`. That function inserts the session (`mode = solo`, `status = complete`), one contributor whose `assigned_positions` are every frame, the shot rows, and one `memories` row with `kind = photo-strip` and `visibility = circle`, in one transaction. The tag is `photo-booth`. The calendar date is the saver's timezone. Authenticated clients have no insert grant on the booth tables, and a direct insert of a photo-strip memory is rejected. The same 10-memories-per-10-minutes limit and the 100 MB circle quota apply. Upstash, when it is configured, checks `memory:{user id}` first.

The action then uploads each JPEG into the private `memories` bucket at `{circle id}/{session id}/{position}.jpg`. If an upload fails, it deletes the memory. That delete removes the session, and the shot trigger removes any object that landed. There is no combined image in storage. The wall signs each frame for five minutes and draws the strip again with the theme that was saved. Those signed URLs are another origin, so the wall canvas can show the frames and cannot export them. Download on the booth page exports a canvas whose frames are still local blobs.

Download uses the share sheet when the phone allows sharing a file, and otherwise a normal download. It does not call the server.

Pass the Booth is the other mode on the same page. Live Together is not built. The starter picks Kawaii or Minimal, 4-cut or 2-cut, and a filter, then shoots the top half (`creatorPositions`: frames 0 and 1 on a 4-cut, frame 0 on a 2-cut). `create_pass_booth` inserts an open session, both contributors, and the starter's shot rows. The partner's positions are the bottom half. The app only passes the other person in an active couple, using `resolveCouplePartner`, so a pending circle and a group both get an explanation instead of a camera. The database does not read the kind of circle. It accepts whichever other active member the caller names, which is how the isolation test lets a third member in on purpose and proves they see nothing when they were not named.

The JPEGs upload after the rows exist, into the same private `memories` bucket. A failed upload calls `discard_pass_booth`, which deletes that open session only when the partner has no frames yet. The partner later calls `submit_pass_shots` for their positions and `finish_pass_booth`. Finish is the step that inserts the photo-strip memory, and only when every position has a shot. The memory's author is whoever finished it. The wall labels a pass with both names. Each person's filter is baked into their JPEG. If the two filters differ, the caption line says Passed and does not pretend there was one filter.

An open pass expires 7 days after it starts. Opening the circle calls `expire_pass_booths`, and so does loading the booth page. That marks the session expired and deletes the unfinished frames. The shot trigger deletes the JPEGs. The same call deletes a booth object with no shot row that is older than 24 hours. A memory photo uses a different path, so it is not matched. The starter can cancel an open pass. The partner cannot. Cancel removes the frames and does not create a memory.

While the pass is open, cancelled, or expired, select policies and `can_read_booth_object` allow only the two contributors. A finished pass is `status = complete`, and every active member can read it, the same as a solo strip. There is still no insert or update grant on the booth tables. Upstash, when it is configured, checks `booth-pass:{user id}` before a start (10 per 10 minutes, matching the SQL count) and `memory:{user id}` before the partner's frames, because that step can create a memory. The push, when VAPID is configured, says "It's your turn in the photo booth." and opens `/circles/{id}/booth`. It does not include a name, a caption, or a photo. No new environment variable and no new region: Supabase stays in Oregon (`us-west-2`), Vercel stays in `pdx1`, and Upstash Redis stays in `us-west-2`.

Leaving a circle does not yet cancel an open pass. That happens with the leave flow.

## Letters

`letters` is one person writing to one other person in the same circle. The page calls it Dear and then their name. That name is the recipient's display name, read when the page renders, not stored on the row. In a couple there is no recipient field. `resolveCouplePartner` is the same helper Thinking of You uses, so a pending circle and a group both refuse the write. The group picker is a later phase. The database still allows a letter to any other active member, which is how the isolation test builds a 3-person circle.

Seven categories are in code and in `private.letter_category_known`: need motivation, need help, feeling sad, feeling lonely, distance is too hard, when we fight, when you miss me. A circle adds more in `letter_categories`. Those rows are readable by every active member. They are labels, not letter text. A built-in name cannot be added again. Ten new labels per person per 10 minutes.

The body is up to 8,000 characters. An optional title is up to 80 and cannot contain `@`. Design is `minimal`, `kawaii`, or `retro-film`, which only changes the paper on the page. `circle_type` is not in any letter policy.

Who can read a row: the sender, always; the recipient only when `delivered_at` is set; nobody else. A member who has set `left_at` fails `is_active_member` and gets nothing. A signed-in insert cannot set `delivered_at`, `opened_at`, `status`, or `qstash_message_id`. The sender can set `scheduled_for`. The before-insert trigger delivers a letter written for now (`status = delivered`, `delivered_at = now()`). A time at least a minute ahead and at most two years ahead stays `scheduled`, with `delivered_at` null. Anything sooner raises `hsummer_letter_schedule`. Ten letters per 10 minutes still applies. Upstash Redis, when both of its variables are set, checks `letter:{user id}` first. A direct insert never reaches Redis. QStash is a different Upstash product and is not that rate limit.

The clock the sender picks is the recipient's timezone, stored as a UTC instant. `2027-02-14 08:00` in `America/Los_Angeles` is `2027-02-14T16:00:00.000Z`. A time that does not exist on a daylight-saving spring-forward morning is refused. `qstash_message_id` stays off the authenticated grants. The secret key writes it after QStash accepts the message.

When `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY` are all set, and the site origin is public https, `queueLetterDelivery` publishes to `https://qstash.upstash.io` (QStash is global; there is no region in that URL). Redis stays in `us-west-2`. The callback is `POST /api/letters/deliver`. It checks the `upstash-signature` header with both signing keys before it reads or writes. A missing key or a bad signature is 401 and does not deliver. `deliver_scheduled_letter` is service-role only. It returns `early` (the route answers 500 so QStash retries), `delivered`, `already`, `cancelled`, or `missing`. If either person has left, the row is cancelled.

If any QStash variable is missing, the origin is localhost, the publish fails, or the message id cannot be stored, the letter stays `scheduled` and nothing is queued. Opening the app calls `deliver_due_letters` for each active circle. That delivers rows whose `scheduled_for` is already in the past, for letters the caller sent or is meant to receive. The same open calls `sync_auto_checkpoints`. Both are safe to repeat. The push, when VAPID is configured, still says "You have a new letter."

The sender can cancel a scheduled letter or move its time. Cancel deletes the QStash message when the id was stored. A new time deletes the old message and publishes another. A delivered row matches no update policy, so the writer cannot edit it after it is sent.

The recipient's page does not include the body until they open it. The open button plays a short seal animation, then `open_letter` sets `opened_at` and inserts one `memories` row with `kind = letter`, `visibility = selected`, and the recipient in `memory_viewers`. The memory stores the title, or the words "A letter", not the body. The author of that memory is the sender, so both people can read it and a third member cannot. A second open returns the same memory. The sender cannot add another viewer or flip the memory to the whole circle. The push, when VAPID is configured, says "You have a new letter." and nothing else.

Leaving a circle does not yet cancel a letter that is still waiting from the leave screen. Delivery does cancel it when the callback or the app-open path sees that a person has left. The leave screen itself is a later week.

## Still Us

A countdown is a label and a calendar date, with no time and no zone. Days remaining are calendar days in the viewer's own timezone, so two people looking at the same reunion on the same local date see the same count. A couple circle gets one row, label "Still Us", `target_date` null, from an after-insert trigger on `circles`. The week 12 migration also inserts that row for couple circles that already exist. The couple cannot insert a second countdown or delete the one they have (`hsummer_countdown_couple`). That limit is the trigger, which reads `circle_type`. The policies do not. A group can hold several. The create form is still couple-only, so the extra-countdown form is only reached if a group circle already exists.

Checkpoints sit on a countdown in the same circle. `trigger` is `auto-by-date` or `manual`. Ten new checkpoints per person per 10 minutes, in the trigger and in `checkpoint:{user id}` when Redis is configured. `hit_at` is not granted on insert or update. `sync_auto_checkpoints` sets it for auto checkpoints whose date is today or earlier in the caller's timezone, under an advisory lock for that circle. `hit_checkpoint` does the same for a manual row, and a second tap returns the same memory. Both file one `memories` row with `kind = milestone`, `visibility = circle`, `body` equal to the checkpoint label, and tag `still-us`. A unique index on `checkpoint_id` plus a swallowed unique violation means two devices opening the app create one memory. The push says "A countdown checkpoint was reached." and does not include the label.

A milestone has no photo and no delete button on the wall. Deleting the checkpoint cascades the memory. An unhit checkpoint can be removed. A hit one cannot, from the action.

## Push

A push has three pieces.

1. **The browser** asks permission (that has to be a tap, especially on iOS), subscribes with our VAPID public key, and POSTs the subscription to `/api/push/subscribe`. The route saves `endpoint`, `p256dh`, and `auth` on `push_subscriptions`, with `user_id` taken from the verified session, not from the JSON body.
2. **The server** asks `web-push` to encrypt a small JSON payload and POST it to each endpoint. `/api/push/test` loads the caller's own rows with their session. `/api/pings` loads the partner's rows with the secret key, because those rows are owner-only and the sender must not gain a policy on them. VAPID proves the request comes from us. The private key stays in `env.server.ts`. One person can have many rows (phone, laptop, an old browser). The send loops every row.
3. **The service worker** (`public/sw.js`) receives the `push` event and shows a notification. A click stays on this origin. A Thinking of You opens that circle. The test notification still opens `/home`.

iOS delivers web push only to a Home Screen app, and only on iOS 16.4+. `useNeedsIosInstall` detects an iPhone or iPad that is not already standalone. On that device the notifications section shows the Share → Add to Home Screen steps and does not render Enable notifications. `enable()` repeats the check, so a tap during the first paint cannot prompt either. `navigator.serviceWorker.ready` is given ten seconds. If registration never finishes, the button stops spinning and asks the person to open the Home Screen icon. Android and desktop subscribe from the browser tab. The manifest (`src/app/manifest.ts`) sets `display: "standalone"` and `start_url: "/home"`, so an installed icon opens the app rather than the marketing page. iOS often ignores `start_url` and reopens the page that was added. The landing page sends a signed-in person to `/home` for that case. The wordmark in the signed-in header goes to `/home` as well.

Payloads are built in `src/lib/push/payload.ts`. The test notification's body is a fixed sentence. A ping is either "Thinking of you." or "Missing you." Neither string contains a name, because a lock screen is visible to anyone holding the phone. The name is in the signed-in list.

When the push service answers **404** or **410**, the subscription is dead (expired, or the user turned it off). `subscriptionsToPrune` returns those ids. The test route deletes them with the caller's session. The ping route deletes them with the secret key, and only rows that belong to the recipient. Other errors, including a network failure with no status code, keep the row. That choice is a pure function so the unit tests do not need a real push service.

Both routes are POST on purpose. A GET would run from a prefetch or an `<img>` and could buzz a phone.

The ping is inserted before the push, with the user's client. If the secret key or the VAPID keys are missing, the row still exists and the response says notifications are not configured. A missing device does not undo the gesture.

## Environment variables

`src/lib/env.ts` is safe for Client Components. It only reads `NEXT_PUBLIC_` variables, and it reads them as `process.env.NEXT_PUBLIC_SOMETHING` rather than `process.env[name]`. Next.js inlines public variables into the browser bundle only for that static form. Placeholder values from `.env.example` count as "not configured", so copying the example file cannot accidentally call a fake project.

`src/lib/env.server.ts` imports `server-only`. A Client Component that imported it would fail the build. The VAPID private key, the Supabase secret key, the optional Upstash Redis token, and the optional QStash token and signing keys are read there, inside the request, not at module scope. Thinking of You uses the secret key that was already required. The bucket list does not add a required variable. Redis is read only by the rate-limit helper, and only when both of its variables are set. QStash is read only by the letter scheduler and the deliver route, and only when all three of its variables are set. A placeholder value counts as missing, so scheduling degrades to the app-open path.

## PWA files

| File                                         | Role                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| `src/app/manifest.ts`                        | Name, standalone display, icons                        |
| `public/sw.js`                               | `push` and `notificationclick`                         |
| `public/icons/`                              | Stable icon URLs for the manifest and the notification |
| `src/app/icon.png`, `src/app/apple-icon.png` | Favicon and Apple touch icon                           |
| `src/components/service-worker-register.tsx` | Registers `/sw.js` after the page loads                |
| `src/components/install-hint.tsx`            | iOS Home Screen instructions                           |

The icons are a small generated mark (two overlapping circles). `npm run generate:icons` redraws them. They are placeholders, not a finished logo.

## Tests and CI

Vitest covers the pieces that are easy to get wrong and expensive to test by hand: the push payload shape (including that a ping payload has no name), which status codes delete a subscription, subscription JSON parsing, the VAPID key decoder, open-redirect filtering, the placeholder env rules (including an empty or placeholder Upstash pair), the profile field rules, the ping request rules (no recipient field, couple partner resolution, the 10-in-10-minutes cap, `Missing<name>` copy), bucket-list field checks, and the 429 responses. The ping route test feeds a fake session: ten recent sends return HTTP 429 and the sentence the button shows, and a database `hsummer_rate_limited` error does the same. The Upstash helper returns that 429 when a test double says the window is full, and it falls through to Postgres when Redis is absent, throws, or does not answer in time.

The loaders are covered the same way, with a fake client instead of a database. `loadBucketItems` sorts idea, then planned (dated ones before an empty date), then done, and drops a category the app does not know. `loadRecentPings` turns a row into the in-app phrase, names a missing sender "Former member", and formats the time in the viewer's zone (a bad zone falls back to UTC). A mood-share row's phrase is "Feeling" plus the emoji. `loadCurrentMoods` drops an emoji outside the palette. `loadMemories` signs a photo for five minutes, drops an unknown kind, and refuses a signed URL that is not a displayable http(s) address. `loadCircles` and `loadCircle` drop an unknown circle type, sign an avatar only when the object path is in that member's folder, and leave a legacy `https://` photo alone. `loadOwnProfile` refuses a signed URL that is not a displayable http(s) address. The mood action tests check that an unchecked share box does not call the ping sender, and that a rate-limited share still counts the mood as saved. The memory action tests check that a note does not upload a file, and that a JPEG's EXIF is gone from the bytes sent to Storage.

`src/lib/auth/local-supabase.ts` is the gate for the test sign-in route. The route at `src/app/api/test/sign-in/route.ts` returns 404 unless `E2E_TEST_AUTH` is exactly `1` and the Supabase URL is `http` on `localhost`, `127.0.0.1`, or `::1`. A hosted `https://….supabase.co` URL stays closed even if the flag is set. The route then creates a user with the admin API (display name and timezone in user metadata, so the signup trigger fills `profiles`) and redirects to `/auth/callback` with the magic-link token. The callback calls `verifyOtp` and writes the cookie. Next reports `request.url` as `http://localhost:3000` even when the browser is on `http://127.0.0.1:3000`. Those hosts do not share cookies, so `src/lib/auth/request-origin.ts` sends loopback redirects to the `Host` header and leaves every other host on `request.url`. The address has to end in `@example.com`. `POST /api/test/sign-in` is what Playwright calls after it has opened the sign-in page. It is not a second product sign-in.

`scripts/backup-lib.mjs` is the part of the weekly dump that can be tested without a database. It accepts a Session pooler URI whose host is `aws-<index>-us-west-2.pooler.supabase.com` (Oregon, where the project lives) or `aws-<index>-us-west-1.pooler.supabase.com` (an older secret) and whose port is 5432. It rejects the transaction pooler (6543), the direct `db.<ref>.supabase.co` host (IPv6 on the free plan; GitHub Actions is IPv4), any other region, a missing password, and a project URL that is not `https://<ref>.supabase.co`. It keeps the newest 8 dump object names and ignores anything else in the bucket.

`npm run test:rls` is a separate Vitest config (`vitest.rls.config.mts`) that talks to local Supabase. It creates two users with the Auth admin API, signs each of them in, and checks:

- the second user gets zero rows from the first user's `account_private`, and cannot update or insert one
- profile and `account_private` payloads have no `email` property, selecting the `email` column fails, and the Data API schema lists no email column
- a display name equal to an email is stored as "New member", and an update that tries to save an email is rejected
- the second user cannot change the first user's display name, including with an update that is not filtered to one id
- the first user can upload a PNG under their own folder and open it with a signed URL; the second user cannot download it, sign it, or upload into that folder
- the service-role key can still read `auth.users.email`, which is how the test shows the address exists and is not copied into `profiles`
- in a 3-member circle created directly in the test database, the sender and the recipient can read a 1:1 ping (including `secret_variant`) and an outsider cannot
- the third member of that circle gets zero rows for that 1:1 ping, cannot update or spoof it, and can read a whole-circle ping (`to_user_id` null) in the same circle
- a couple insert with a null recipient is rejected, a member who sets `left_at` immediately loses the ping, and the 11th ping inside 10 minutes is rejected
- in a 3-member circle, every active member can read and edit a bucket item (including one they did not add), an outsider's select is empty and their insert, update, and delete do nothing, and a member who sets `left_at` immediately loses the list
- in a 3-member circle, every active member can read a mood, only the owner can upsert or delete it, a second upsert updates the one row, an outsider and a spoofed user id are rejected, a member who sets `left_at` disappears from the list (including for the people who stayed), and a mood-share ping stays invisible to the third member
- the 11th invite row in 15 minutes raises `hsummer_rate_limited` for both a new circle and a regenerated link, and one succeeds after those rows are moved outside the window
- the service role can upload into the private `backups` bucket; a signed-in user cannot list, download, or upload there, and the public object URL is not available
- a circle memory is readable by the other members and hidden from an outsider; a selected memory is readable by the author and the listed viewer, and a third member gets zero rows
- the partner can open a memory photo with a signed URL, an outsider cannot, the public object URL is not available, and a URL signed for two seconds stops working after it expires
- a member who sets `left_at` immediately loses the wall, the 11th memory inside 10 minutes is rejected, and a circle already at 100 MB of `photo_bytes` refuses another photo while still accepting a note

GitHub Actions runs three jobs on every pull request and on `main`. The first runs `node scripts/audit-deps.mjs`, lint, format, typecheck, `npm test`, the production build with placeholder keys, and the Playwright smoke test. The audit fails on a production high or critical advisory. The only ignored high is dev-only `braces` through `eslint-config-next`, which has no patched release. The second starts local Supabase (mailpit stays on; studio, analytics, and realtime stay off), runs `npm run test:rls`, exports the local URL and keys, builds the app with those keys inlined, and runs `npm run test:e2e:local`. `npm test` stays free of Docker. Neither of those jobs has the hosted project's keys. The third checks out full history and runs gitleaks. Dependabot opens weekly update PRs for npm and GitHub Actions.

Playwright's smoke project loads the landing page and the sign-in page with placeholder keys forced in, clicks the magic-link button, checks that `/home`, `/profile`, and `/circles` redirect when nobody is signed in, and checks that `POST /api/test/sign-in` is 404. It does not create a user.

The local project (`playwright.local.config.ts`) throws unless `NEXT_PUBLIC_SUPABASE_URL` is a local http URL and both API keys are set. It starts its own server with `E2E_TEST_AUTH=1` and refuses to reuse a server that is already running, so it cannot attach to a dev server pointed at production. The spec opens `/sign-in`, posts to the test route, creates a couple circle named "Me & Summer", reads the invite link, opens that link signed out, signs in as the second person, confirms **Join circle**, and taps **Thinking of You**. The partner's recent list shows the ping. It then sets a mood with the share box off (the partner sees it, and the recent list does not gain a "Feeling" row) and sets another mood with the box on (the recent list shows the emoji). It adds two notes in different months, a note only the author can see, and a one-pixel PNG. The tag filter hides the other month. The partner sees the shared note and the photo, and does not see the private note. It writes a letter, checks the partner cannot see the body, and opens the seal. It sets the Still Us date, marks a manual checkpoint, and checks both walls show that one memory. It then schedules a later letter and checks the partner cannot see that body. VAPID stays a placeholder, so the button's status line says notifications are not configured, and the row is still saved.

A separate workflow, `.github/workflows/db-backup.yml`, is the weekly dump. It is not part of the pull-request jobs. See Backups below.

## Backups

Supabase's free plan does not take automatic backups. The weekly Action is the backup. It runs Mondays at 11:00 UTC (3:00 AM Pacific Standard Time, which is Oregon in the winter, and 4:00 AM during daylight time) and whenever someone starts it from the Actions tab.

The connection string has to be the Session pooler on port 5432, in Oregon (`us-west-2`) or the older Northern California host (`us-west-1`). GitHub-hosted runners do not have a usable IPv6 path to the direct host `db.<project-ref>.supabase.co`, and port 6543 is transaction mode, which `pg_dump` cannot use. `scripts/check-backup-url.mjs` exits before `pg_dump` if the secret is the wrong shape. The project URL and the secret key are separate secrets. The secret key is what uploads the file. It is the same key the app already uses on the server to reach a partner's push subscriptions. It is not a `NEXT_PUBLIC_` variable.

`pg_dump` runs from the Postgres 17 image, matching `major_version` in `supabase/config.toml`. Three files are written: `schema.sql` (public and private, no data), `data.sql` (those schemas, data only), and `auth-data.sql` (`auth.users` and `auth.identities`). The CLI's own dump skips the auth schema, and `profiles.id` references `auth.users`, so a data-only restore without those two tables would fail the foreign key. The three files are tarred and encrypted with GnuPG (AES-256, the passphrase from `BACKUP_PASSPHRASE`). The plaintext is deleted on the runner before the upload.

The upload goes to the private Storage bucket `backups`, object prefix `weekly/`. The week 6 migration creates that bucket with public access off, a 50 MB limit, and `application/octet-stream` only. It creates no Storage policy. Signed-in users and the public object URL get nothing. The RLS suite uploads with the service role and checks that the other test user cannot list, download, or upload. The Action then deletes dump objects older than the newest eight. The repository is public, so the file is not stored as a workflow artifact.

Avatar objects and memory photos are not in the dump. A database restore brings rows back, not the bytes in the `avatars` or `memories` buckets.

The restore drill is in the README. Short version: decrypt, `npx supabase db reset` so the local migrations create an empty schema, then in one `psql` session set `session_replication_role` to `replica` and load `auth-data.sql` and `data.sql`. Do not apply `schema.sql` on top of that reset. `schema.sql` is there so the backup still contains the structure. The hosted `postgres` role is not asked to disable triggers during the dump.

## What was left out on purpose

Cache Components (the Next.js 16 default for new apps) are off. Signed-in pages depend on the request cookie, and there is no public data worth caching yet. The comment is in `next.config.ts`.

Copying the `avatars` and `memories` buckets into the weekly backup is later. Cancelling a waiting letter from the leave screen is later too; delivery already cancels it when a person has left. A daily cron was not added. Opening the app is what hits auto checkpoints and delivers a letter whose time has passed when QStash is not configured. The database dump is what week 6 stores. `completed_at` is set when a bucket item is marked done, and that does not add a memory. The wall is notes and photos added by hand. Join is limited by `private.join_attempts`, now serialized. Pings, invites, and memories are each limited by their own insert trigger. Upstash, when its two variables are set, checks the same caps first and is not required. Memory photos are stripped of EXIF before they are stored. A JPEG, or a photo the phone labeled HEIC, is drawn to a canvas in the browser first so the pixels are upright and the file is under 2 MB. A small PNG or WebP is uploaded as-is and stripped on the server. Profile photos go through the same canvas step, and the server removes EXIF and text chunks before the avatar object is saved. A signed photo URL lasts five minutes. While a photo is on screen, the page asks for a new one before that, and again when the phone wakes. An image that already failed does that once. Avatar URLs last an hour and refresh the same way. The age-confirmation column is null until that screen exists. The group-circle create form, recipient pickers, and whole-circle pings from the app are later. The leave screen is later too; leaving is possible through the membership column so the status rule and the access cutoff can be tested. `POST /api/pings` still refuses a mood field. The share checkbox is what writes `mood-share`, and only for the partner in an active couple.

## File map

| Path                                     | What it is                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `src/app/page.tsx`                       | Landing page                                                                   |
| `src/app/sign-in/page.tsx`               | Sign-in page (server), renders the form                                        |
| `src/app/sign-in/actions.ts`             | Magic link and Google, after the auth rate limit                               |
| `src/app/privacy/page.tsx`               | Privacy explanation for the beta. Not legal advice.                            |
| `src/app/terms/page.tsx`                 | Terms explanation for the beta. Not legal advice.                              |
| `src/components/site-footer.tsx`         | Copyright line, privacy link, terms link                                       |
| `src/lib/security/headers.ts`            | CSP, HSTS, and the other document headers                                      |
| `src/lib/auth/attempt.ts`                | Auth rate limit: Upstash, then `consume_auth_attempt`                          |
| `src/lib/auth/turnstile.ts`              | Checks the Google sign-in widget token with Cloudflare                         |
| `SECURITY_AUDIT.md`                      | Item-by-item audit and where each control lives                                |
| `SECURITY.md`                            | How to report a vulnerability in private                                       |
| `src/app/home/page.tsx`                  | Signed-in home. Shows the profile, circles, and the test push.                 |
| `src/app/circles/page.tsx`               | List circles and create a couple circle                                        |
| `src/app/circles/[id]/page.tsx`          | Still Us, letters, mood, memory wall, bucket list, invite, and Thinking of You |
| `src/app/circles/letter-actions.ts`      | Write, schedule, cancel, reschedule, and open a letter                         |
| `src/app/circles/countdown-actions.ts`   | Save the reunion date, add a checkpoint, mark it, or remove it                 |
| `src/app/api/letters/deliver/route.ts`   | Signed QStash callback. Delivers one letter.                                   |
| `src/components/letters.tsx`             | The Dear form, Now or Later, the seal, and the opened letter                   |
| `src/components/still-us.tsx`            | The countdown, the day count, and the checkpoints                              |
| `src/lib/schedule/time.ts`               | Calendar days and a wall-clock time in an IANA zone                            |
| `src/lib/schedule/qstash.ts`             | Publish, cancel, and verify. Skips the network when keys are absent            |
| `src/lib/letters/schedule.ts`            | Stores the message id, or leaves the letter waiting                            |
| `src/lib/circles/prepare.ts`             | On app load: sync checkpoints and deliver due letters                          |
| `src/lib/countdowns/load.ts`             | Load countdowns and checkpoints for the circle page                            |
| `src/lib/letters/fields.ts`              | Categories, designs, sizes, and write-error sentences                          |
| `src/lib/letters/load.ts`                | Load letters. Omits a sealed body from the recipient's page                    |
| `src/lib/letters/notify.ts`              | Push "You have a new letter." to the recipient's devices                       |
| `src/app/circles/memory-actions.ts`      | Add or remove a memory. Strips EXIF, then uploads.                             |
| `src/components/memory-wall.tsx`         | The wall, month groups, tag filter, and the add form                           |
| `src/components/refresh-signed-urls.tsx` | Asks for new signed URLs before they expire                                    |
| `src/lib/memories/prepare-photo.ts`      | Browser resize, HEIC, and JPEG orientation                                     |
| `src/lib/circles/invite-token.ts`        | Keeps the raw invite token in localStorage                                     |
| `src/lib/memories/fields.ts`             | Sizes, tags, dates, the five-minute URL, write-error sentences                 |
| `src/lib/memories/photo.ts`              | Magic-byte check and EXIF / text-chunk stripping                               |
| `src/lib/memories/group.ts`              | Month groups and the tag filter                                                |
| `src/lib/memories/load.ts`               | Load the wall and sign each photo for five minutes                             |
| `src/app/circles/mood-actions.ts`        | Set or clear your current mood. Share calls the ping sender.                   |
| `src/components/circle-moods.tsx`        | The mood buttons, the share box, and the Realtime subscription                 |
| `src/lib/moods/fields.ts`                | The six moods, write-error sentences, and the saved-status line                |
| `src/lib/moods/load.ts`                  | Load the circle's current moods                                                |
| `src/app/circles/bucket-actions.ts`      | Add, edit, and remove a bucket item                                            |
| `src/components/bucket-list.tsx`         | The list, the add form, and the Realtime subscription                          |
| `src/components/bucket-item.tsx`         | One item: edit, status, and remove                                             |
| `src/lib/bucket/fields.ts`               | Categories, dates, links, and write-error sentences                            |
| `src/lib/bucket/load.ts`                 | Load and sort the circle's items                                               |
| `src/lib/rate-limit/enforce.ts`          | Optional Upstash check, with a Postgres fallback                               |
| `src/app/api/pings/route.ts`             | Send Thinking of You to the partner                                            |
| `src/components/thinking-of-you.tsx`     | The button, including the hidden `Missing<name>` control                       |
| `src/components/recent-pings.tsx`        | The short list of pings this person is allowed to see                          |
| `src/lib/pings/fields.ts`                | Request shape, partner resolution, rate-limit numbers                          |
| `src/lib/pings/send.ts`                  | Insert under RLS, then push to every device of the recipient                   |
| `src/lib/pings/load.ts`                  | Recent pings for the circle page                                               |
| `src/lib/supabase/admin.ts`              | Secret-key client, used to deliver and prune partner devices                   |
| `src/app/circles/actions.ts`             | Create, rename, regenerate invite                                              |
| `src/app/join/[token]/page.tsx`          | Sign in, then confirm the invite                                               |
| `src/app/join/actions.ts`                | Redeem the token                                                               |
| `src/lib/circles/fields.ts`              | Names, token shape, rate-limit numbers                                         |
| `src/lib/circles/load.ts`                | Load a circle, its members, and signed avatars                                 |
| `src/app/profile/page.tsx`               | View and edit the signed-in user's profile                                     |
| `src/app/profile/actions.ts`             | Save profile, remove photo                                                     |
| `src/components/profile-form.tsx`        | Name, timezone, and photo fields                                               |
| `src/components/profile-avatar.tsx`      | Round photo or initial                                                         |
| `src/components/signed-in-header.tsx`    | Home, Profile, and sign-out                                                    |
| `src/components/sign-in-form.tsx`        | Google button and magic-link form                                              |
| `src/components/push-panel.tsx`          | Enable, test, and disable notifications                                        |
| `src/lib/profile/fields.ts`              | Name, timezone, and image checks                                               |
| `src/lib/profile/stored-avatar.ts`       | Strips EXIF from a profile photo before upload                                 |
| `src/lib/profile/load.ts`                | Load the caller's profile and a signed avatar URL                              |
| `src/app/auth/callback/route.ts`         | Exchange the auth code or token hash                                           |
| `src/app/auth/sign-out/route.ts`         | Clear the session                                                              |
| `src/app/api/push/subscribe/route.ts`    | Save or delete this device                                                     |
| `src/app/api/push/test/route.ts`         | Send the test push and prune dead rows                                         |
| `src/lib/supabase/`                      | Browser client, server client, proxy, session helper                           |
| `src/lib/database.types.ts`              | Hand-written types for the tables                                              |
| `src/app/api/test/sign-in/route.ts`      | Local-only Playwright sign-in. 404 everywhere else.                            |
| `src/lib/auth/local-supabase.ts`         | The URL and flag gate for that route                                           |
| `e2e/circle-flow.spec.ts`                | Sign in, create, invite, join, ping against local Supabase                     |
| `playwright.local.config.ts`             | Refuses to start unless the Supabase URL is local                              |
| `scripts/backup-lib.mjs`                 | Session-pooler check, retention of 8 dumps, upload errors                      |
| `scripts/upload-backup.mjs`              | Uploads the encrypted dump and deletes older ones                              |
| `.github/workflows/db-backup.yml`        | Weekly `pg_dump`, encrypt, upload to the private bucket                        |
| `supabase/migrations/`                   | SQL applied to the database                                                    |
| `supabase/tests/rls.test.ts`             | Two-user RLS checks, including the backups bucket                              |
| `supabase/config.toml`                   | Local Supabase CLI config                                                      |
