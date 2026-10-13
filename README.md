# Hsummer

A private shared space for people who are far apart. Made for couples, built for groups, friends, and families.

Hsummer is a portfolio project. Couples are the first audience. The data model supports a Circle of any size (a couple, a friend group, a family). This repository has the app shell, sign-in, a test push notification, profiles, and couple circles with invite links. Group, family, and friends circles exist in the database and stay out of the create form until a later phase.

## Stack

- [Next.js](https://nextjs.org/) App Router, React, and TypeScript (strict)
- [Supabase](https://supabase.com/) Postgres, Auth, and Row Level Security
- Installable PWA, Web Push (VAPID)
- Deployed on [Vercel](https://vercel.com/)
- [Vitest](https://vitest.dev/) unit tests, [Playwright](https://playwright.dev/) smoke tests, GitHub Actions

Joining a circle is rate-limited in Postgres (per person and per IP hash). Upstash, for scheduled letters and the later limits on pings and invite creation, is not wired up.

## Local setup

You need Node.js 22 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page and the sign-in page render with the placeholder values in `.env.example`. Sign-in shows a clear message instead of crashing. Nothing talks to Supabase until you replace those placeholders.

### 1. Create a Supabase project

Create a free project in the [Supabase dashboard](https://supabase.com/dashboard). A second project for production can wait.

In **Project Settings → API keys**, copy:

| Dashboard                              | `.env.local`                           |
| -------------------------------------- | -------------------------------------- |
| Project URL                            | `NEXT_PUBLIC_SUPABASE_URL`             |
| Publishable key (`sb_publishable_...`) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Secret key (`sb_secret_...`)           | `SUPABASE_SECRET_KEY`                  |

The publishable key is the new name for the anon key. The secret key is the new name for the service-role key. If your project still shows the legacy names, put the anon key in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the service-role key in `SUPABASE_SERVICE_ROLE_KEY` instead. The app reads either name.

The secret key bypasses Row Level Security. It is server-only. Week 1 does not send it anywhere; a later week uses it for jobs that must bypass RLS. Never prefix it with `NEXT_PUBLIC_`.

### 2. Turn on sign-in

In **Authentication → Sign In / Providers**:

- Email: leave it on. Magic link is the default email method. You do not need passwords.
- Google: enable it. Create an OAuth client in Google Cloud (application type **Web application**).
  - Authorized JavaScript origins: `http://localhost:3000` and `https://hsummer.vercel.app`
  - Authorized redirect URI (this is Supabase, not the app):

    `https://<your-project-ref>.supabase.co/auth/v1/callback`

  Paste the client id and secret into the Supabase Google provider. Supabase has a click-through for this in the provider settings.

In **Authentication → URL Configuration**:

- Site URL: `https://hsummer.vercel.app` once that deployment exists. Until then, `http://localhost:3000` is fine. Magic-link emails use the Site URL when the template uses `{{ .SiteURL }}`.
- Redirect URLs, add each of these exactly:

  - `http://localhost:3000/auth/callback`
  - `http://127.0.0.1:3000/auth/callback`
  - `https://hsummer.vercel.app/auth/callback`

The default magic-link email works when you open the link in the **same browser** that requested it. To open the link on a phone after requesting it on a laptop, change the **Magic Link** email template to:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">
  Sign in to Hsummer
</a>
```

`{{ .SiteURL }}` is the Site URL above (your app), not the Supabase project URL. The callback route accepts both this `token_hash` form and the default `code` form.

### 3. Apply the database migrations

Migrations live in `supabase/migrations` and run in filename order.

| File                                                 | What it adds                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `20261012120000_profiles_and_push_subscriptions.sql` | `profiles`, `push_subscriptions`, signup trigger, owner-only RLS |
| `20261019120000_account_private_and_avatars.sql`     | `account_private`, private `avatars` bucket, profile read helper |

There is no email column on `profiles` or `account_private`. The week 2 file is additive: run it once on a database that already has week 1. Do not edit or paste the week 1 file again.

**Hosted project, SQL editor (no Docker):**

1. Open the Supabase dashboard → **SQL Editor** → **New query**.
2. If week 1 is not applied yet, paste `supabase/migrations/20261012120000_profiles_and_push_subscriptions.sql` and run it once.
3. Paste `supabase/migrations/20261019120000_account_private_and_avatars.sql` and run it once. This creates the private Storage bucket named `avatars`. Do not also click **New bucket**. If you already created an `avatars` bucket by hand, delete that bucket first or this script stops on the duplicate name.
4. Refresh **Storage**. `avatars` should be listed with public access off. Refresh **Table Editor** and confirm `account_private` exists and has no email column.

**Hosted project, CLI:** use this only if week 1 was applied with `supabase db push` (so it is in the migration history). If you pasted week 1 into the SQL editor, use the SQL editor for week 2 as well. `db push` would try to run week 1 again and fail.

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Local Supabase (optional, needs Docker):**

```bash
npx supabase start
npx supabase db reset
npm run test:rls
```

`supabase start` prints a local API URL and keys. Those go in `.env.local` if you want the app pointed at the local stack. The checked-in `supabase/config.toml` already allow-lists `http://localhost:3000/auth/callback`. `npm run test:rls` signs in as two local test users and checks that one cannot read the other's `account_private`, cannot see an email column, and cannot update the other's profile.

### 4. Generate VAPID keys

```bash
npm run generate:vapid
```

That is a wrapper around `npx web-push generate-vapid-keys`. Put the two keys in `.env.local`:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public, fine in the browser
- `VAPID_PRIVATE_KEY` — server only
- `VAPID_SUBJECT` — a real `mailto:you@school.edu` or an `https://` contact page. The example `mailto:you@example.com` is treated as unconfigured.

Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` in `.env.local`. On Vercel, set it to `https://hsummer.vercel.app`.

Restart `npm run dev` after changing any `NEXT_PUBLIC_` variable. Next.js inlines those into the browser bundle.

### 5. Try it

1. Sign in with Google or a magic link.
2. Open `/home`. You should see a display name (from Google, or "New member") and a timezone. Magic-link sign-in sends the browser timezone. Google sign-in leaves timezone at `UTC` until you open the profile page.
3. Open **Profile**. Change the display name, confirm the timezone (it fills in from this browser when the saved value is still UTC), and upload a JPEG, PNG, or WebP under 2 MB. Save. The photo is stored in the private `avatars` bucket and shown through a signed URL.
4. Tap **Enable notifications**, allow the prompt, then **Send test notification**.

The notification text is generic on purpose. Lock screens are visible to other people, so payloads never include names, letters, or anything else from a Circle.

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import it in the [Vercel dashboard](https://vercel.com/new) (framework preset: Next.js). **Name the project `hsummer`.** That name is what assigns `https://hsummer.vercel.app`. A custom domain such as hsummer.app can be added later; nothing in the app assumes one yet.
3. Add every variable from `.env.example` for **Production** and **Preview**. Use the production Supabase project when you have one. Set `NEXT_PUBLIC_SITE_URL` to `https://hsummer.vercel.app` for Production (Preview can use the same value, or the preview's own origin if you add that origin to Supabase).
4. Deploy. Public variables are read at **build** time, so change them and redeploy rather than only restarting.
5. In Supabase **Authentication → URL Configuration**, set Site URL to `https://hsummer.vercel.app` and keep these redirect URLs:

   - `http://localhost:3000/auth/callback`
   - `http://127.0.0.1:3000/auth/callback`
   - `https://hsummer.vercel.app/auth/callback`

Preview deployments each get their own URL. Add the ones you actually sign in from, or Supabase will refuse the redirect.

## Test push on an iPhone

Web push on iOS works only from a site that was **added to the Home Screen**, and only on **iOS 16.4 or later**. A normal Safari tab will not prompt and will not deliver.

1. Deploy to `https://hsummer.vercel.app` (or use a tunnel to your laptop). The page must be HTTPS. Localhost is the only exception, and an iPhone cannot use your laptop's localhost.
2. On the iPhone, open `https://hsummer.vercel.app` in Safari.
3. Share → **Add to Home Screen**. The app shows this hint when it detects iOS and is not already installed.
4. Open Hsummer from the new icon, sign in, tap **Enable notifications**, then **Send test notification**.

Android and desktop can do the same from the browser tab; they do not need the install step.

If iOS push is still silent: confirm you opened the Home Screen icon (not the Safari tab), that the permission is allowed in iOS Settings, and that the VAPID subject is a real `mailto:` or `https:` URL.

## Scripts

| Command                  | What it does                           |
| ------------------------ | -------------------------------------- |
| `npm run dev`            | Next.js dev server                     |
| `npm run lint`           | ESLint                                 |
| `npm run format`         | Prettier                               |
| `npm run typecheck`      | `next typegen` and `tsc --noEmit`      |
| `npm test`               | Vitest unit tests                      |
| `npm run test:rls`       | RLS tests (needs `npx supabase start`) |
| `npm run test:e2e`       | Playwright smoke test (starts the app) |
| `npm run build`          | Production build                       |
| `npm run generate:vapid` | Print a VAPID key pair                 |

GitHub Actions runs lint, format, typecheck, unit tests, the production build, and the Playwright smoke test on pull requests and on `main`. A second job starts local Supabase and runs the RLS tests. The smoke test does not need real Supabase credentials.

No new environment variables are required for profiles. Photo upload uses the same Supabase URL and publishable key as sign-in.

## Circles and invites

A signed-in person opens **Circles**, creates a couple circle, and gets one invite link. The link is shown once. Sharing uses the phone's share sheet, or copies the link. Opening it signs the other person in, then asks them to confirm. The circle stays **pending** until that second person joins, and this screen is the invite rather than letters or a ping. After they join it becomes **active**. A third account that uses the same link is refused. Making a new link turns the old one off, and a couple that is already full still refuses the new link.

The raw token is not stored. The database keeps a SHA-256 hash. Redeeming the link is one transaction, and it is limited to 8 tries per person and 20 per IP hash inside 15 minutes.

### Apply the week 3 SQL

Do this in the Supabase dashboard. No new bucket and no new environment variable.

1. Open **SQL Editor → New query**.
2. Do **not** paste or re-run `supabase/migrations/20261012120000_profiles_and_push_subscriptions.sql` or `supabase/migrations/20261019120000_account_private_and_avatars.sql`. Those are already applied. Running them again will fail.
3. Open `supabase/migrations/20261026120000_circles_and_invites.sql` in this repo, paste the whole file, and run it **once**.
4. Refresh **Table Editor**. Confirm `circles`, `circle_members`, `circle_invites`, and `circle_invite_redemptions`. None of them has an email column. `account_private` is unchanged.
5. Vercel deploys the circle pages from this merge. Apply the SQL before creating a circle. Then sign in, open `/circles`, create one, and open the invite link in a second account.

Use `npx supabase db push` only if week 1 and week 2 were applied with the CLI and are already in the migration history. If those were pasted into the SQL editor, paste week 3 there too.

## What is not in this version

Letters, the bucket list, memory photos, Realtime, QStash, and Upstash rate limits are later weeks. Do not add those tables to an earlier migration. The `avatars` bucket is only for profile photos. Leave, account deletion, and the group-circle create form are later too. The database already accepts group, family, and friends circles so the isolation tests can use them.

See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for how the code is put together.
