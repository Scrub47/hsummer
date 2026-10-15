# Hsummer

Made for couples, built for groups, friends, and families.

A private shared space for people who are far apart. Couples are the first audience. The same Circle holds a couple, a few friends, or a family, and the database already isolates each person. Group screens come later. This repository is the app through Phase 3 (Still Us and the photo booth) plus launch readiness: leaving a circle, deleting an account, downloading your data, and a seeded demo couple.

## Screenshots

These slots are empty on purpose. Add a PNG under `docs/screenshots/` and drop it in here when there is one worth showing.

| Slot        | What to capture                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Home        | Signed-in home: name, mood, and the notification buttons. `docs/screenshots/home.png`                    |
| Circle      | An active couple circle: mood, memory wall, bucket list, Thinking of You. `docs/screenshots/circle.png`  |
| Memory wall | One month with a note and a photo, and the tag row. `docs/screenshots/memory-wall.png`                   |
| iPhone      | The Home Screen icon, and a notification that says only "Thinking of you." `docs/screenshots/iphone.png` |

## What you can do

- Sign in with Google or an email magic link. There is no password.
- Set a display name, a photo, and a timezone. Email stays in sign-in. Circle members never see it.
- Create a couple circle and share one invite link. It works once. The circle stays pending until the second person joins.
- Tap Thinking of You. It goes to your partner, with a push when their phone is subscribed. On an iPhone that requires the Home Screen app (iOS 16.4 or later).
- Keep a shared bucket list (restaurants, movies, plans) that updates live.
- Set a mood. It shows in the circle. A notification is sent only if you check the share box.
- Add notes and photos to the memory wall. Group them by month and tag. Show them to the whole circle, or only to the people you pick. Photo links expire after five minutes.
- Write a letter. It opens with your partner's name. They break a seal to read it. The memory of that letter stays between the two of you. A push, if their phone is subscribed, says only "You have a new letter."
- Set a Still Us date and checkpoints. A letter can be set to arrive later.
- Take a Solo photo strip, or pass the booth so your partner fills the other frames. Live Together is later.
- Leave a circle. The default keeps what you added. You can remove your photos, notes, sent letters, and booth frames instead. Scheduled letters to or from you are cancelled.
- Download a ZIP of the JSON and image files you can already see. It is not a backup of the whole database.
- Delete your account. Your login, avatar files, and push subscriptions go with it. Shared contributions stay as Former member unless you remove them.
- Try the demo from the landing page. Alex and Jordan are fictional. The circle resets every night and does not take uploads.

Not in this version: group-circle screens and Live Together. See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for how the code is put together.

## Tech stack

| Layer                 | Choice                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| App                   | Next.js (App Router) and TypeScript, on Vercel in `pdx1` (Portland)                      |
| Database, auth, files | Supabase Postgres, Auth, Storage, and Realtime in Oregon (`us-west-2`)                   |
| Rate limits           | Upstash Redis in `us-west-2`, optional. Postgres enforces the same caps when it is unset |
| Push                  | Web Push (VAPID). iOS needs the installed app                                            |
| Tests                 | Vitest, Playwright, and a Row Level Security suite against local Supabase                |
| Backup                | Weekly GitHub Action: `pg_dump`, encrypt, upload to a private bucket                     |

Do not move those regions. Preview and production on Vercel stay in `pdx1`. The Supabase project stays in Oregon. An Upstash database, if you create one, stays in `us-west-2`. QStash is global and has no region. `vercel.json` lists the daily cron only. It does not set a region.

## Architecture

```mermaid
flowchart LR
  browser[Browser]
  next[Next.js on Vercel pdx1]
  supabase[Supabase Oregon]
  redis[Upstash Redis us-west-2]
  qstash[QStash global]
  push[Browser push service]
  sentry[Sentry optional]

  browser --> next
  next --> supabase
  next --> redis
  next --> qstash
  qstash --> next
  next --> push
  push --> browser
  next --> sentry
```

The browser talks only to this app. Postgres, Auth, and Storage are Supabase. Redis is the optional rate-limit counter. QStash wakes the app when a scheduled letter is due. Sentry receives an error report only when `SENTRY_DSN` is set.

## Run it locally

You need Node.js 22 or newer. Local Supabase needs Docker.

```bash
npm install
cp .env.example .env.local
npx supabase start
npx supabase db reset
```

`supabase start` boots Postgres, Auth, and Storage on your machine. `db reset` applies every file in `supabase/migrations`, in order, and gives you a clean database. That is the database the app should talk to while you are developing.

Point `.env.local` at that local stack. The script below prints the three values. It refuses to print anything unless the API URL is local.

```bash
node scripts/print-local-supabase-env.mjs
```

Paste what it prints into `.env.local`, replacing the placeholders:

| Printed name                           | `.env.local` |
| -------------------------------------- | ------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | same name    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same name    |
| `SUPABASE_SECRET_KEY`                  | same name    |

The other names in `.env.example` can stay as they are for a first run. VAPID keys are only needed when you want a real push (`npm run generate:vapid`). Leave the Upstash lines empty. Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

Restart the dev server after any `NEXT_PUBLIC_` change. Next.js bakes those into the browser bundle.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign-in, a circle, and the memory wall all talk to the local stack you just started.

The checked-in `supabase/config.toml` already allow-lists `http://localhost:3000/auth/callback` and `http://127.0.0.1:3000/auth/callback`. Magic-link mail from the local stack is in the Inbucket URL that `supabase start` prints (usually [http://127.0.0.1:54324](http://127.0.0.1:54324)).

To stop the local stack: `npx supabase stop`.

### Hosted Supabase instead

Create a project in Oregon (`us-west-2`). Copy the project URL and keys into `.env.local` using the names in `.env.example`. The publishable key is the new name for the anon key. The secret key is the new name for the service-role key. If the dashboard still shows the legacy names, put them in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. The secret key bypasses Row Level Security and must never start with `NEXT_PUBLIC_`.

Apply each file in `supabase/migrations` once, in filename order, in the SQL editor. Do not run a file twice.

| File                                                 | What it adds                                |
| ---------------------------------------------------- | ------------------------------------------- |
| `20261012120000_profiles_and_push_subscriptions.sql` | profiles, push subscriptions                |
| `20261019120000_account_private_and_avatars.sql`     | private settings, private `avatars` bucket  |
| `20261026120000_circles_and_invites.sql`             | circles, members, invites                   |
| `20261102120000_pings.sql`                           | Thinking of You                             |
| `20261109120000_bucket_items_and_rate_limits.sql`    | bucket list, tighter rate limits            |
| `20261116120000_backup_bucket.sql`                   | private `backups` bucket                    |
| `20261123120000_current_moods.sql`                   | moods                                       |
| `20261130120000_memories.sql`                        | memory wall, private `memories` bucket      |
| `20261207120000_security_hardening.sql`              | narrower column grants, auth attempt counts |
| `20261221120000_letters.sql`                         | letters, custom categories, letter memories |
| `20261228120000_still_us.sql`                        | scheduled letters, Still Us countdowns      |
| `20270104120000_solo_booth.sql`                      | Solo photo booth, photo-strip memories      |
| `20270118120000_pass_the_booth.sql`                  | Pass the Booth: async frames, 7-day expiry  |
| `20270125120000_launch_readiness.sql`                | Leave, delete account, demo circle, exports |

In **Authentication → URL Configuration**, set the Site URL and add redirect URLs:

- `http://localhost:3000/auth/callback`
- `http://127.0.0.1:3000/auth/callback`
- `https://hsummer.vercel.app/auth/callback`

To open a magic link on a phone after requesting it on a laptop, change the Magic Link email template so the link is:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">
  Sign in to Hsummer
</a>
```

`{{ .SiteURL }}` is the Site URL above. The callback route accepts this `token_hash` form and the default `code` form. The default template only works in the same browser that requested the link.

## Tests

| Command                  | What it does                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm test`               | Vitest unit tests. No database.                                                                            |
| `npm run test:e2e`       | Playwright smoke test. Placeholder keys, no Supabase.                                                      |
| `npm run test:rls`       | Row Level Security suite. Needs local Supabase (`npx supabase start`).                                     |
| `npm run test:e2e:local` | Playwright circle flow against local Supabase: sign in, create a couple, invite, join, ping, mood, memory. |

The circle flow refuses to start if `NEXT_PUBLIC_SUPABASE_URL` is a hosted project. Run it like this:

```bash
npx supabase start
npx supabase db reset
eval "$(node scripts/print-local-supabase-env.mjs)"
npm run test:e2e:local
```

`E2E_TEST_AUTH` is set by that Playwright config. Do not set it in `.env.local` or on Vercel.

Other commands: `npm run lint`, `npm run format`, `npm run typecheck`, `npm run build`, `npm run generate:vapid`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and on `main`.

1. **check** — lint, format, typecheck, unit tests, production build with placeholder keys, Playwright smoke test.
2. **RLS and local e2e** — starts local Supabase on the runner, runs the RLS suite, builds the app against that local API, and runs the circle flow.

Neither job has the hosted project's keys.

## Weekly backup

Supabase's free plan does not take automatic backups. `.github/workflows/db-backup.yml` runs Mondays at 11:00 UTC, and whenever you start it from the Actions tab. It dumps the database with `pg_dump` (Postgres 17), encrypts the archive, and uploads it to the private `backups` bucket. The file is not a GitHub artifact, because this repository is public. The eight newest dumps are kept. Photo files are not in the dump.

The Action reads four GitHub secrets, not Vercel env vars: `SUPABASE_DB_URL` (Session pooler URI, port 5432, host in `us-west-2` or the older `us-west-1`), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `BACKUP_PASSPHRASE` (at least 16 characters). It rejects the transaction pooler (port 6543) and the direct database host.

Restore a dump into local Supabase:

```bash
gpg --batch --yes --pinentry-mode loopback \
  --decrypt --passphrase 'your passphrase' \
  --output backup.tgz hsummer-YYYYMMDDTHHMMSSZ-aaaaaaaa.tgz.gpg
tar xzf backup.tgz
npx supabase start
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica" \
  -f auth-data.sql \
  -f data.sql \
  -c "SET session_replication_role = DEFAULT"
```

Do not load `schema.sql` after `db reset`. The local migrations already created the tables.

## iPhone push

Web push on iOS works only from a site that was added to the Home Screen, and only on iOS 16.4 or later. A Safari tab will not prompt and will not deliver.

1. Deploy to `https://hsummer.vercel.app` (localhost on a laptop is not reachable from the phone).
2. Open that URL in Safari → Share → **Add to Home Screen**.
3. Open Hsummer from the new icon, sign in, tap **Enable notifications**, then **Send test notification**.

The notification text is generic on purpose. Lock screens are visible to other people.

## Scheduled letters (QStash)

QStash is global. There is no region to pick. Redis rate limits are a different Upstash product and stay in `us-west-2`. Supabase stays in Oregon (`us-west-2`). The Vercel project stays in `pdx1`. Do not add a `vercel.json` region override for this.

If the three QStash variables are missing, a letter set for later still saves. It arrives the next time one of you opens Hsummer after that time.

1. Open [console.upstash.com](https://console.upstash.com).
2. In the left sidebar, open **QStash**. This is not the Redis database. There is no region dropdown.
3. Copy **QSTASH_TOKEN** from the QStash details page.
4. Open the **Signing Keys** tab. Copy **QSTASH_CURRENT_SIGNING_KEY** (current) and **QSTASH_NEXT_SIGNING_KEY** (next).
5. In the Vercel project, open **Settings → Environment Variables**.
6. Add each name as a **Sensitive** variable for **Production** and **Preview**. Sensitive variables cannot be stored for Development. Skip Development, or add the same names there as plain (non-sensitive) variables if you need local `vercel env pull`. Local `.env.local` can hold them either way.
7. Redeploy. A new variable is not visible to a deployment that is already running.

The callback is `POST /api/letters/deliver`. It rejects a body whose `upstash-signature` does not verify. Preview deployments protected by Vercel Authentication will answer 401 to QStash before that check runs. Test the on-time arrival on Production, or turn protection off for that path while you try it.

## Daily cron and error reports

`GET /api/cron/daily` runs at 11:00 UTC. It purges circles that have been empty for 30 days, sweeps quiet passes and checkpoints, resets the demo couple, and deletes export ZIPs older than an hour.

| Name          | Vercel type | Environments                                                                                                                           |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CRON_SECRET` | Sensitive   | Production. Add Preview only if that deployment should run the cron. At least 16 characters. The route answers 401 when it is missing. |
| `SENTRY_DSN`  | Sensitive   | Production and Preview, optional. Server only. Do not use `NEXT_PUBLIC_SENTRY_DSN`. The app runs the same when it is empty.            |

`GET /api/health` returns `{ "ok": true }` and does not touch the database. Point an uptime check there if you want one.

## Security

Row Level Security is the access check. The secret key is server-only. Invite tokens are stored as hashes. Photo and avatar buckets are private. The export bucket is private and has no client policy. A personal ZIP contains only rows that person can already read, plus the image bytes, and never another person's members-only letter.

The historical pass is [SECURITY_AUDIT.md](./SECURITY_AUDIT.md). The Phase 5 section of that file explains the statements in `20270125120000_launch_readiness.sql` that Supabase may flag. Those deletes run when someone leaves, deletes an account, or when the daily job purges a circle that has been empty for 30 days. Applying the migration does not delete existing rows.
