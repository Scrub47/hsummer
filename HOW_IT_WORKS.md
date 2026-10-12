# How Hsummer works (week 1)

This is the map of the repository as it stands after the first week. It is written for reading the code, not as a changelog.

Hsummer will be a private space shared by a Circle: a couple, a few friends, or a family. Week 1 only builds the shell that everything else hangs on. There is no Circle table yet. That is deliberate. The risky piece this week is Web Push on an iPhone, which only works from an installed PWA.

## Shape of the app

```
Browser
  landing page, sign-in form, home page
  service worker (public/sw.js)  ← push events
        │
        ▼
Next.js (App Router) on Vercel
  src/proxy.ts                     refresh the session cookie
  src/app/auth/callback            finish Google / magic link
  src/app/api/push/*               save a device, send a test push
        │
        ▼
Supabase
  Auth (auth.users holds the email)
  Postgres: profiles, push_subscriptions
  Row Level Security: a signed-in user can only touch their own rows
```

Next.js serves both the UI and the server routes, so there is one TypeScript codebase. Supabase holds the data and the login session. Vercel hosts the Next.js app. The browser's push service (Apple, Google, Mozilla) delivers notifications; our server only talks to the endpoint the browser gave us.

## Request path

1. Every document and API request goes through `src/proxy.ts` (this used to be called middleware). The matcher skips images, the service worker, and Next's own static files.
2. `src/lib/supabase/proxy.ts` builds a server Supabase client that reads and writes cookies on that request. It calls `auth.getClaims()`, which verifies the JWT and refreshes it when it is about to expire.
3. Server Components cannot write cookies. If the proxy did not refresh the token, the next request would present a used refresh token and Supabase would sign the user out. That is why the refresh lives in the proxy even though each page also checks the user.
4. The proxy redirects `/home` to `/sign-in` when there is no verified user. That redirect is a convenience. The home page and the push routes call `getClaims()` again. Do not trust `getSession()` on the server: it reads the cookie without checking the signature.

If the Supabase URL or key is missing, or still the placeholder from `.env.example`, the proxy skips the client entirely. Public pages render. `/home` redirects to sign-in. The sign-in form explains that the project is not configured.

## Auth

Sign-in is passwordless.

- **Google** uses `signInWithOAuth`. Supabase sends the browser to Google and back to `/auth/callback?code=`.
- **Magic link** uses `signInWithOtp`. The email either comes back with a `code` (same browser, PKCE cookie) or a `token_hash` (works across devices, after the email template change in the README). `src/app/auth/callback/route.ts` handles both.

The callback only redirects to a path on our own origin. `safeNextPath` rejects `https://somewhere-else` and `//somewhere-else`, so a link cannot bounce a signed-in browser to another site.

Sign-out is a POST form to `/auth/sign-out`. A GET would let any page on the internet sign the user out with an image tag.

The browser client (`src/lib/supabase/client.ts`) and the server client (`src/lib/supabase/server.ts`) are separate on purpose. The browser client is a singleton. The server client is created per request because it has to see that request's cookies. `setAll` in the server client is wrapped in try/catch: from a Server Component, writing cookies throws, and the proxy has already done the write.

## Profiles, and why email is not a column

`auth.users` is Supabase's account table. The email lives there and is not exposed through the Data API.

`public.profiles` is what other people will eventually be allowed to see: display name, an optional avatar, and an IANA timezone. A trigger, `handle_new_user`, inserts that row when Auth creates a user. The function is `security definer` with an empty `search_path`. It runs as the migration owner, so it can insert even though clients have no insert policy. If the function raised, signup would fail, so a missing or weird name becomes "New member" and a bad timezone becomes `UTC`.

The trigger never reads `new.email`. A name that contains `@` is thrown away. The table constraint repeats that rule so a later update cannot store an address either.

RLS policies are owner-only (`id = auth.uid()`). When Circles exist, a new policy will let co-members read the display name, avatar, and timezone. They still must not gain access to `auth.users`. There is no insert or delete policy for profiles: the trigger inserts, and deleting the auth user cascades.

`(select auth.uid())` is the form Supabase recommends. Postgres can evaluate it once per query instead of once per row.

## Push

A push has three pieces.

1. **The browser** asks permission (that has to be a tap, especially on iOS), subscribes with our VAPID public key, and POSTs the subscription to `/api/push/subscribe`. The route saves `endpoint`, `p256dh`, and `auth` on `push_subscriptions`, with `user_id` taken from the verified session, not from the JSON body.
2. **The server** (`/api/push/test`) loads the caller's rows and asks `web-push` to encrypt a small JSON payload and POST it to each endpoint. VAPID proves the request comes from us. The private key stays in `env.server.ts`.
3. **The service worker** (`public/sw.js`) receives the `push` event and shows a notification. A click opens `/home` on this origin only.

iOS delivers web push only to a Home Screen app, and only on iOS 16.4+. `InstallHint` detects an iPhone or iPad that is not already standalone and explains the Share → Add to Home Screen steps. The manifest (`src/app/manifest.ts`) sets `display: "standalone"`, which is what makes the installed icon open without Safari chrome.

Payloads are built in `src/lib/push/payload.ts`. The test notification's body is a fixed sentence. It has no name and no Circle content, because a lock screen is visible to anyone holding the phone. Later features should keep that rule: the push says something happened, and the app shows the private part after sign-in.

When the push service answers **404** or **410**, the subscription is dead (expired, or the user turned it off). `subscriptionsToPrune` returns those ids and the route deletes them. Other errors, including a network failure with no status code, keep the row. That logic is a pure function so the unit tests do not need a real push service.

The route is POST on purpose. A GET would run from a prefetch or an `<img>` and could buzz the phone.

Week 1 does not use the Supabase secret key for this. The user's own session can read and delete their own subscriptions under RLS. The secret key bypasses RLS; it is documented and parsed so it is ready, and it should stay unused until a job truly needs it.

## Environment variables

`src/lib/env.ts` is safe for Client Components. It only reads `NEXT_PUBLIC_` variables, and it reads them as `process.env.NEXT_PUBLIC_SOMETHING` rather than `process.env[name]`. Next.js inlines public variables into the browser bundle only for that static form. Placeholder values from `.env.example` count as "not configured", so copying the example file cannot accidentally call a fake project.

`src/lib/env.server.ts` imports `server-only`. A Client Component that imported it would fail the build. The VAPID private key and the Supabase secret key are read there, inside the request, not at module scope.

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

Vitest covers the pieces that are easy to get wrong and expensive to test by hand: the push payload shape, which status codes delete a subscription, subscription JSON parsing, the VAPID key decoder, open-redirect filtering, and the placeholder env rules.

Playwright loads the landing page and the sign-in page with placeholder keys forced in, clicks the magic-link button, and checks that the home page redirects when nobody is signed in. It does not create a user.

GitHub Actions runs lint, Prettier, typecheck, Vitest, `next build`, and that smoke test.

## What was left out on purpose

Cache Components (the Next.js 16 default for new apps) are off. Signed-in pages depend on the request cookie, and there is no public data worth caching yet. The comment is in `next.config.ts`.

`account_private`, circles, invites, letters, Storage, Realtime, QStash, and rate limits are later weeks. The migration file should stay limited to `profiles` and `push_subscriptions` so those later tables arrive with their own RLS policies and tests.

## File map

| Path                                  | What it is                                           |
| ------------------------------------- | ---------------------------------------------------- |
| `src/app/page.tsx`                    | Landing page                                         |
| `src/app/sign-in/page.tsx`            | Sign-in page (server), renders the form              |
| `src/app/home/page.tsx`               | Signed-in placeholder. Loads the profile.            |
| `src/components/sign-in-form.tsx`     | Google button and magic-link form                    |
| `src/components/push-panel.tsx`       | Enable, test, and disable notifications              |
| `src/app/auth/callback/route.ts`      | Exchange the auth code or token hash                 |
| `src/app/auth/sign-out/route.ts`      | Clear the session                                    |
| `src/app/api/push/subscribe/route.ts` | Save or delete this device                           |
| `src/app/api/push/test/route.ts`      | Send the test push and prune dead rows               |
| `src/lib/supabase/`                   | Browser client, server client, proxy, session helper |
| `src/lib/database.types.ts`           | Hand-written types for the two tables                |
| `supabase/migrations/`                | SQL applied to the database                          |
| `supabase/config.toml`                | Local Supabase CLI config                            |
