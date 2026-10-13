# How Hsummer works

This is the map of the repository as it stands after the bucket list. It is written for reading the code, not as a changelog.

Hsummer is a private space shared by a Circle: a couple, a few friends, or a family. Profiles came first. Who may read one is a single function, and that function now includes people who share an active circle. Circles, memberships, invite links, pings, and a shared bucket list are in the database. A 1:1 ping is readable only by the sender and the recipient. A bucket item is readable and editable by every active member of that circle. Letters are not built yet.

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
  src/app/join/actions.ts          redeem an invite link
  src/app/api/push/*               save a device, send a test push
  src/app/api/pings                Thinking of You, then push the partner
        │
        ▼
Supabase
  Auth (auth.users holds the email)
  Postgres: profiles, account_private, circles, members, invites,
            pings, bucket_items, push_subscriptions
  Realtime: bucket_items, so both people see edits
  Storage: private bucket "avatars"
  Row Level Security: circle rows for active members; a 1:1 ping
                      only for its sender and recipient
```

Next.js serves both the UI and the server routes, so there is one TypeScript codebase. Supabase holds the data and the login session. Vercel hosts the Next.js app. The browser's push service (Apple, Google, Mozilla) delivers notifications; our server only talks to the endpoint the browser gave us.

## Request path

1. Every document and API request goes through `src/proxy.ts` (this used to be called middleware). The matcher skips images, the service worker, and Next's own static files.
2. `src/lib/supabase/proxy.ts` builds a server Supabase client that reads and writes cookies on that request. It calls `auth.getClaims()`, which verifies the JWT and refreshes it when it is about to expire.
3. Server Components cannot write cookies. If the proxy did not refresh the token, the next request would present a used refresh token and Supabase would sign the user out. That is why the refresh lives in the proxy even though each page also checks the user.
4. The proxy redirects `/home`, `/profile`, and `/circles` to `/sign-in` when there is no verified user, and it keeps the path in `next` so sign-in can come back. `/join/...` stays public: the page itself asks the person to sign in, then confirm. That redirect is a convenience. The pages and the push routes call `getClaims()` again. Do not trust `getSession()` on the server: it reads the cookie without checking the signature.

If the Supabase URL or key is missing, or still the placeholder from `.env.example`, the proxy skips the client entirely. Public pages render, including an invite link that does not look like a token. `/home`, `/profile`, and `/circles` redirect to sign-in. The sign-in form explains that the project is not configured.

## Auth

Sign-in is passwordless. The profile work does not change this.

- **Google** uses `signInWithOAuth`. Supabase sends the browser to Google and back to `/auth/callback?code=`.
- **Magic link** uses `signInWithOtp`. The email either comes back with a `code` (same browser, PKCE cookie) or a `token_hash` (works across devices, after the email template change in the README). `src/app/auth/callback/route.ts` handles both. The magic-link call sends the browser's IANA timezone in user metadata so the signup trigger can store it.

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

`updateProfile` in `src/app/profile/actions.ts` checks the session again. The user id comes from the JWT, not from the form. Display name, timezone, and the photo are checked in `src/lib/profile/fields.ts` before any request: the name is 1–80 characters and cannot contain `@`, the timezone must match the database's IANA pattern and be a real zone, and the photo's bytes must be JPEG, PNG, or WebP up to 2 MB. The filename the browser sends is ignored. The object name is `{user id}/{uuid}.jpg|png|webp`.

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

The invite token is 32 random bytes, hex encoded. The row stores `token_hash`, the SHA-256 of that string. Authenticated clients are not granted the column, so a member cannot read the hash and a client cannot search by token. `redeem_invite` hashes the token from the link. The raw value is returned once, from create or regenerate. The circle page keeps it in `sessionStorage` so a refresh of that tab can still share it. Generating a new link sets `revoked_at` on the old row. The partial unique index allows one live link per circle.

Redeem is one transaction. It records the attempt, locks the circle, locks the invite, and then either adds a member or returns a state (`missing`, `revoked`, `expired`, `full`, `already_member`, `rate_limited`, `joined`). Returning, instead of raising, commits the attempt. A raised error would roll the counter back and the limit would not hold. The limits are 8 attempts per user and 20 per IP hash in 15 minutes. The server hashes the IP (`hsummer-join-v1:` plus the first forwarded hop) and passes the hash. The raw IP is not stored. A couple that already has two active members stays full even if someone regenerates the link. That capacity check lives in the function, not in an RLS policy.

`/join/[token]` is the link. Signed out, it asks the person to sign in and comes back via `next`. Signed in, it previews the circle name and posts to `redeem_invite`. Nothing joins them until they confirm.

While a circle is pending, its page is the invite prompt. Thinking of You is not shown there. After the second person joins, an active couple gets one button and a short list of recent pings. The button does not ask who to send to. `resolveCouplePartner` returns the only other active member, and the route refuses a group, a pending circle, and any body that includes `toUserId`.

`BROADCAST_PINGS_ENABLED` is false. A whole-circle ping is a row with `to_user_id` null. The select policy lets every active member read that shape, and the insert policy allows the null, so the RLS suite can create a 3-member group directly and prove both sides: the third member sees the null row and does not see a 1:1 row between the other two. The app never writes the null. A couple cannot write it either. The insert trigger reads `circle_type` and raises `hsummer_couple_needs_recipient`. That read stays out of the policies. `circle_type` is still only a default.

The same trigger stamps `sent_at` from the database clock and allows 10 pings per sender per 10 minutes, across every circle. An advisory lock makes two overlapping requests share one count. The route counts with `count: "exact"` and returns 429 with a plain sentence when the person is already at the cap. If that count cannot be read, the route refuses the send instead of guessing. The trigger remains the check a direct insert cannot skip.

New invite rows are capped the same way: 10 per person per 15 minutes, covering both a new circle and a regenerated link. The trigger is `private.circle_invites_guard_insert`, on `circle_invites`, so `create_circle` and `regenerate_invite` share one count. It stamps `created_at` from the database clock. Redeem still allows 8 attempts per person and 20 per IP hash inside 15 minutes. A before-insert trigger on `private.join_attempts` takes an advisory lock per user and then per IP hash, so two overlapping tries cannot both pass the count. The lock order is always user, then IP, so those two locks cannot deadlock with each other.

Upstash Redis is optional. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set, the server asks `@upstash/ratelimit` (sliding window, same numbers) before the database call and returns the same sentence on 429. A Redis error or a timeout falls through to Postgres. When the variables are empty, Postgres is the only limiter and nothing else changes. A person who calls Supabase directly never hits Upstash, which is why the SQL stays.

`secret_variant` is the `Missing<name>` easter egg. A long-press on the button, or a visually hidden control whose name is "Missing Summer", sets the flag. The recent list then says "Missing Summer". The push body is the fixed sentence "Missing you." The display name is not in the payload.

A member can set their own `left_at`. They cannot clear it; coming back is another redemption, and only `redeem_invite` is allowed to do that. The moment `left_at` is set, `is_active_member` is false, so that person gets zero rows from the circle and stops being able to read the other person's profile.

## Bucket list

`bucket_items` is one list per circle. The columns are title, category (`restaurant`, `movie`, `activity`, `date-idea`, `ldr-idea`), status (`idea`, `planned`, `done`), an optional planned date, optional notes, and an optional http(s) link. `created_by` is who added it. The insert trigger sets that to `auth.uid()`, so a client cannot name someone else. Deleting that account sets the column to null, and the page says "Former member". A person who left is no longer in the member list, so their name resolves the same way: the profile read rule no longer includes them.

`planned_date` is a Postgres `date`. The page formats it in UTC so a viewer in the US does not see the previous calendar day. `completed_at` is stamped when status becomes `done` and cleared if the item moves back to idea or planned. The client is not granted that column. Marking an item done does not create a Memory Wall row yet. That table arrives with the memory week; `completed_at` is the record that the completion happened.

Policies call `private.is_active_member`. There is no `circle_type` in them. Select, insert, update, and delete are all allowed for every active member, including an item they did not add. An outsider and a member who has set `left_at` get zero rows. The circle page shows the list while the circle is still pending. Thinking of You stays hidden until the circle is an active couple. That matches the plan: the list works before the second person joins.

The form is a client component. Saves are server actions, so the user id comes from the verified session and `revalidatePath` redraws the page in the same response. A Supabase Realtime channel on `bucket_items`, filtered to this circle, calls `router.refresh()` for the other person's edits. The migration adds the table to the `supabase_realtime` publication when that publication exists, and sets `replica identity full` so an update or delete still carries `circle_id` for the filter. If the publication was missing when the SQL ran, the dashboard toggle is the same change. Own saves still appear without Realtime, because the action revalidates the page.

Changing the status submits the whole edit form, so a status tap also stores notes that were already typed. Removing an item asks once in the page, then deletes. The card's React key includes `updated_at`, so a partner's save replaces a half-finished draft with the saved row.

## Push

A push has three pieces.

1. **The browser** asks permission (that has to be a tap, especially on iOS), subscribes with our VAPID public key, and POSTs the subscription to `/api/push/subscribe`. The route saves `endpoint`, `p256dh`, and `auth` on `push_subscriptions`, with `user_id` taken from the verified session, not from the JSON body.
2. **The server** asks `web-push` to encrypt a small JSON payload and POST it to each endpoint. `/api/push/test` loads the caller's own rows with their session. `/api/pings` loads the partner's rows with the secret key, because those rows are owner-only and the sender must not gain a policy on them. VAPID proves the request comes from us. The private key stays in `env.server.ts`. One person can have many rows (phone, laptop, an old browser). The send loops every row.
3. **The service worker** (`public/sw.js`) receives the `push` event and shows a notification. A click stays on this origin. A Thinking of You opens that circle. The test notification still opens `/home`.

iOS delivers web push only to a Home Screen app, and only on iOS 16.4+. `useNeedsIosInstall` detects an iPhone or iPad that is not already standalone. On that device the notifications section shows the Share → Add to Home Screen steps and does not render Enable notifications. `enable()` repeats the check, so a tap during the first paint cannot prompt either. Android and desktop subscribe from the browser tab. The manifest (`src/app/manifest.ts`) sets `display: "standalone"`, which is what makes the installed icon open without Safari chrome.

Payloads are built in `src/lib/push/payload.ts`. The test notification's body is a fixed sentence. A ping is either "Thinking of you." or "Missing you." Neither string contains a name, because a lock screen is visible to anyone holding the phone. The name is in the signed-in list.

When the push service answers **404** or **410**, the subscription is dead (expired, or the user turned it off). `subscriptionsToPrune` returns those ids. The test route deletes them with the caller's session. The ping route deletes them with the secret key, and only rows that belong to the recipient. Other errors, including a network failure with no status code, keep the row. That choice is a pure function so the unit tests do not need a real push service.

Both routes are POST on purpose. A GET would run from a prefetch or an `<img>` and could buzz a phone.

The ping is inserted before the push, with the user's client. If the secret key or the VAPID keys are missing, the row still exists and the response says notifications are not configured. A missing device does not undo the gesture.

## Environment variables

`src/lib/env.ts` is safe for Client Components. It only reads `NEXT_PUBLIC_` variables, and it reads them as `process.env.NEXT_PUBLIC_SOMETHING` rather than `process.env[name]`. Next.js inlines public variables into the browser bundle only for that static form. Placeholder values from `.env.example` count as "not configured", so copying the example file cannot accidentally call a fake project.

`src/lib/env.server.ts` imports `server-only`. A Client Component that imported it would fail the build. The VAPID private key, the Supabase secret key, and the optional Upstash token are read there, inside the request, not at module scope. Thinking of You uses the secret key that was already required. The bucket list does not add a required variable. Upstash is read only by the rate-limit helper, and only when both of its variables are set.

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
- the 11th invite row in 15 minutes raises `hsummer_rate_limited` for both a new circle and a regenerated link, and one succeeds after those rows are moved outside the window

GitHub Actions runs that job on every pull request. It starts the local stack with `npx supabase start` and does not need the hosted project's keys. `npm test` stays free of Docker.

Playwright loads the landing page and the sign-in page with placeholder keys forced in, clicks the magic-link button, and checks that `/home` and `/profile` redirect when nobody is signed in. It does not create a user.

## What was left out on purpose

Cache Components (the Next.js 16 default for new apps) are off. Signed-in pages depend on the request cookie, and there is no public data worth caching yet. The comment is in `next.config.ts`.

Letters, memory photos, QStash, and the Memory Wall row for a finished bucket item are later weeks. `completed_at` is set when an item is marked done, and the memory week is what turns that into a scrapbook entry. Join is limited by `private.join_attempts`, now serialized. Pings are limited by the insert trigger. Invite creation is limited by the invite insert trigger. Upstash, when its two variables are set, checks the same caps first and is not required. Avatar bytes are not stripped of EXIF yet; the memory-wall week does that for photos people share. The age-confirmation column is null until that screen exists. The group-circle create form, recipient pickers, and whole-circle pings from the app are later. The leave screen is later too; leaving is possible through the membership column so the status rule and the access cutoff can be tested. Mood-share is a `ping_type` the table accepts and the route refuses.

## File map

| Path                                  | What it is                                                     |
| ------------------------------------- | -------------------------------------------------------------- |
| `src/app/page.tsx`                    | Landing page                                                   |
| `src/app/sign-in/page.tsx`            | Sign-in page (server), renders the form                        |
| `src/app/home/page.tsx`               | Signed-in home. Shows the profile, circles, and the test push. |
| `src/app/circles/page.tsx`            | List circles and create a couple circle                        |
| `src/app/circles/[id]/page.tsx`       | Bucket list, invite, and Thinking of You in an active couple   |
| `src/app/circles/bucket-actions.ts`   | Add, edit, and remove a bucket item                            |
| `src/components/bucket-list.tsx`      | The list, the add form, and the Realtime subscription          |
| `src/components/bucket-item.tsx`      | One item: edit, status, and remove                             |
| `src/lib/bucket/fields.ts`            | Categories, dates, links, and write-error sentences            |
| `src/lib/bucket/load.ts`              | Load and sort the circle's items                               |
| `src/lib/rate-limit/enforce.ts`       | Optional Upstash check, with a Postgres fallback               |
| `src/app/api/pings/route.ts`          | Send Thinking of You to the partner                            |
| `src/components/thinking-of-you.tsx`  | The button, including the hidden `Missing<name>` control       |
| `src/components/recent-pings.tsx`     | The short list of pings this person is allowed to see          |
| `src/lib/pings/fields.ts`             | Request shape, partner resolution, rate-limit numbers          |
| `src/lib/pings/send.ts`               | Insert under RLS, then push to every device of the recipient   |
| `src/lib/pings/load.ts`               | Recent pings for the circle page                               |
| `src/lib/supabase/admin.ts`           | Secret-key client, used to deliver and prune partner devices   |
| `src/app/circles/actions.ts`          | Create, rename, regenerate invite                              |
| `src/app/join/[token]/page.tsx`       | Sign in, then confirm the invite                               |
| `src/app/join/actions.ts`             | Redeem the token                                               |
| `src/lib/circles/fields.ts`           | Names, token shape, rate-limit numbers                         |
| `src/lib/circles/load.ts`             | Load a circle, its members, and signed avatars                 |
| `src/app/profile/page.tsx`            | View and edit the signed-in user's profile                     |
| `src/app/profile/actions.ts`          | Save profile, remove photo                                     |
| `src/components/profile-form.tsx`     | Name, timezone, and photo fields                               |
| `src/components/profile-avatar.tsx`   | Round photo or initial                                         |
| `src/components/signed-in-header.tsx` | Home, Profile, and sign-out                                    |
| `src/components/sign-in-form.tsx`     | Google button and magic-link form                              |
| `src/components/push-panel.tsx`       | Enable, test, and disable notifications                        |
| `src/lib/profile/fields.ts`           | Name, timezone, and image checks                               |
| `src/lib/profile/load.ts`             | Load the caller's profile and a signed avatar URL              |
| `src/app/auth/callback/route.ts`      | Exchange the auth code or token hash                           |
| `src/app/auth/sign-out/route.ts`      | Clear the session                                              |
| `src/app/api/push/subscribe/route.ts` | Save or delete this device                                     |
| `src/app/api/push/test/route.ts`      | Send the test push and prune dead rows                         |
| `src/lib/supabase/`                   | Browser client, server client, proxy, session helper           |
| `src/lib/database.types.ts`           | Hand-written types for the tables                              |
| `supabase/migrations/`                | SQL applied to the database                                    |
| `supabase/tests/rls.test.ts`          | Two-user RLS checks                                            |
| `supabase/config.toml`                | Local Supabase CLI config                                      |
