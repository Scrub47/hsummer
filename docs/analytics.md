# Usage numbers

Hsummer can count how the app is used without storing letter text, names, or email in an analytics tool. Two pieces are optional. With neither one set up, the app behaves the same as before.

The database queries in `docs/metrics.sql` do not need either product. They read the rows Hsummer already stores.

## What gets counted

Vercel Web Analytics counts page views. Speed Insights records loading times. Neither one needs an environment variable.

PostHog records a short list of actions: signed up, circle created, partner joined, letter sent, letter opened, ping sent, mood shared, booth photo taken, strip completed, memory added, reaction added, reply sent, keepsake exported, and push enabled. A circle type or a booth mode can ride along. The words of a letter, a reply, a name, an email, a caption, and an emoji do not.

PostHog is told the Supabase user id and nothing else. Signing out clears that id in the browser. Settings, then Privacy, has a switch that stops PostHog in that tab immediately and saves the choice on the account. The demo account never loads PostHog.

## Turn on Vercel Analytics and Speed Insights

1. Open the Hsummer project on Vercel.
2. Open the **Analytics** tab and click **Enable**.
3. Open the **Speed Insights** tab and click **Enable**.
4. Redeploy so the new scripts are on the live site.

The written steps are here:

- https://vercel.com/docs/analytics/quickstart
- https://vercel.com/docs/speed-insights/quickstart

There is no key to copy. The strict content security policy already allows the Vercel script and vitals hosts.

## Turn on PostHog

1. Create a project: https://us.posthog.com/signup
2. Copy the project API key. It starts with `phc_`. It is on the project settings page: https://us.posthog.com/settings/project
3. On Vercel, add `NEXT_PUBLIC_POSTHOG_KEY` for Production and Preview. Use a normal Config variable, not a Secret. Next copies `NEXT_PUBLIC_` values into the browser bundle, so a Secret would not stay secret.
4. Leave `NEXT_PUBLIC_POSTHOG_HOST` unset to use `https://us.i.posthog.com`. An EU project uses `https://eu.i.posthog.com` instead.
5. Redeploy.

The browser does not call PostHog directly. Next forwards `/ingest` to that host, which keeps ad blockers and the content security policy from dropping the requests. Session replay is off. Text and inputs are not captured.

When the key is empty, the PostHog library is not loaded.

## Apply the database change

`supabase/migrations/20271020120000_feedback.sql` adds the feedback table and the two account columns (the analytics switch, and whether the one-time check-in was closed). Run the migrations the same way as the rest of the project, or paste that file into the Supabase SQL editor once. It is safe to paste again.

## Read the resume numbers

Open the Supabase SQL editor, paste `docs/metrics.sql`, and run it. One row comes back:

- total users and weekly active users
- total circles and weekly active circles
- letters sent
- pings
- how many people were still active 7 days after they joined, and 30 days after
- the average feedback rating, and how many notes that average is based on

Weekly active means someone did something in the last 7 days. Retention is the share of non-demo accounts old enough for that window who did something on or after the window. A brand-new account is not in the retention share yet. Demo rows are excluded. A cancelled letter is not counted as sent.

## Feedback

Settings has **Send feedback**. The sheet asks for a rating from 1 to 5, and can take a short note (1000 characters) and a category (bug, idea, or love). The row stores the app version and the browser's user agent. People can insert their own rows and cannot read them back. Five notes an hour is the cap.

After 7 days, or after 10 letters, a one-time prompt asks "How's Hsummer so far?". Closing it or sending a rating hides it for good.
