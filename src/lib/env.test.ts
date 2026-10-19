import { afterEach, describe, expect, it } from "vitest";

import {
  getPostHogPublicConfig,
  getSupabaseBrowserConfig,
  getVapidPublicKey,
  isSecretSupabaseKey,
} from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("public env", () => {
  it("treats the example placeholders as unconfigured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "your-publishable-or-anon-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(getSupabaseBrowserConfig()).toBeNull();
    expect(getVapidPublicKey()).toBeNull();
  });

  it("accepts a publishable key, and the legacy anon key when that is all you have", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_examplevalue";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(getSupabaseBrowserConfig()).toEqual({
      url: "https://abcd.supabase.co",
      key: "sb_publishable_examplevalue",
    });

    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon";

    expect(getSupabaseBrowserConfig()?.key).toBe(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon",
    );
  });

  it("refuses a secret key in the public env var", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_realvalue";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isSecretSupabaseKey("sb_secret_realvalue")).toBe(true);
    expect(getSupabaseBrowserConfig()).toBeNull();

    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ role: "service_role" }),
    ).toString("base64url");
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `${header}.${payload}.sig`;
    expect(getSupabaseBrowserConfig()).toBeNull();

    const anonPayload = Buffer.from(JSON.stringify({ role: "anon" })).toString(
      "base64url",
    );
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `${header}.${anonPayload}.sig`;
    expect(getSupabaseBrowserConfig()?.key.endsWith(".sig")).toBe(true);
  });

  it("loads PostHog only for a real key and defaults the host", () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    expect(getPostHogPublicConfig()).toBeNull();

    process.env.NEXT_PUBLIC_POSTHOG_KEY = "your-posthog-key";
    expect(getPostHogPublicConfig()).toBeNull();

    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_example_project_key";
    expect(getPostHogPublicConfig()).toEqual({
      key: "phc_example_project_key",
      host: "https://us.i.posthog.com",
    });

    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(getPostHogPublicConfig()?.host).toBe("https://eu.i.posthog.com");
  });
});
