import { defineConfig, devices } from "@playwright/test";

import { isLocalSupabaseUrl } from "./src/lib/auth/local-supabase";

/**
 * Circle flow against local Supabase only.
 *
 * Start the stack (`npx supabase start`), then export the local URL and keys
 * (`node scripts/print-local-supabase-env.mjs`) before `npm run test:e2e:local`.
 * This config throws if the URL is not local, so it cannot be pointed at
 * https://hsummer.vercel.app or a hosted Supabase project.
 */

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const secret =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

if (!isLocalSupabaseUrl(supabaseUrl) || !publishable || !secret) {
  throw new Error(
    [
      "The local end-to-end test only runs against local Supabase.",
      "Run `npx supabase start`, then",
      '`eval "$(node scripts/print-local-supabase-env.mjs)"`,',
      "then `npm run test:e2e:local`.",
      "It will not run against production.",
    ].join(" "),
  );
}

export default defineConfig({
  testDir: "e2e",
  testMatch: ["circle-flow.spec.ts", "booth-flow.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: baseURL,
    // Never attach to a dev server that might be using hosted keys.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E_TEST_AUTH: "1",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SECRET_KEY: secret,
      SUPABASE_SERVICE_ROLE_KEY: "",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "your-vapid-public-key",
      VAPID_PRIVATE_KEY: "your-vapid-private-key",
      VAPID_SUBJECT: "mailto:you@example.com",
      NEXT_PUBLIC_SITE_URL: baseURL,
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
    },
  },
});
