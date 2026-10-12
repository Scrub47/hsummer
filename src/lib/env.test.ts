import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseBrowserConfig, getVapidPublicKey } from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
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
});
