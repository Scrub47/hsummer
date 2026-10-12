# Hsummer

A private shared space for people who are far apart. Made for couples, built for groups, friends, and families.

Hsummer is a portfolio project. Couples are the first audience. The data model will support a Circle of any size (a couple, a friend group, a family), but this repository is only the week-1 foundation: the app shell, sign-in, a profile row, and a test push notification.

## Stack

- [Next.js](https://nextjs.org/) App Router, React, and TypeScript (strict)
- [Supabase](https://supabase.com/) Postgres, Auth, and Row Level Security
- Installable PWA, Web Push (VAPID)
- Deployed on [Vercel](https://vercel.com/)
- [Vitest](https://vitest.dev/) unit tests, [Playwright](https://playwright.dev/) smoke tests, GitHub Actions

Upstash (scheduled letters and rate limits) is a later week and is not wired up.

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

### 3. Apply the database migration

The migration is `supabase/migrations/20261012120000_profiles_and_push_subscriptions.sql`. It creates `profiles` and `push_subscriptions`, turns on RLS, and adds a trigger that inserts a profile when someone signs up. There is no email column on `profiles`.

**Hosted project (no Docker):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or open the SQL editor in the dashboard and run that migration file once.

**Local Supabase (optional, needs Docker):**

```bash
npx supabase start
npx supabase db reset
```

`supabase start` prints a local API URL and keys. Those go in `.env.local` if you want the app pointed at the local stack. The checked-in `supabase/config.toml` already allow-lists `http://localhost:3000/auth/callback`.

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
2. Open `/home`. You should see a display name (from Google, or "New member") and a timezone. Magic-link sign-in sends the browser timezone. Google sign-in leaves timezone at `UTC` until a later profile screen.
3. Tap **Enable notifications**, allow the prompt, then **Send test notification**.

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
| `npm test`               | Vitest                                 |
| `npm run test:e2e`       | Playwright smoke test (starts the app) |
| `npm run build`          | Production build                       |
| `npm run generate:vapid` | Print a VAPID key pair                 |

GitHub Actions runs lint, format, typecheck, unit tests, the production build, and the Playwright smoke test on pull requests and on `main`. The smoke test does not need real Supabase credentials.

## What is not in this version

Circles, invites, letters, the bucket list, Storage, Realtime, QStash, and rate limits are later weeks. Do not add those tables to the week-1 migration.

See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for how the code is put together.
