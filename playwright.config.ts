import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  // The circle flow needs local Supabase. It lives in playwright.local.config.ts.
  testIgnore: "circle-flow.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Placeholders, so the smoke test never talks to a real Supabase project
      // even if the developer machine has keys in the environment.
      NEXT_PUBLIC_SUPABASE_URL: "https://your-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "your-publishable-or-anon-key",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "your-vapid-public-key",
      VAPID_PRIVATE_KEY: "your-vapid-private-key",
      VAPID_SUBJECT: "mailto:you@example.com",
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
