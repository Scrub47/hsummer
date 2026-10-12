import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseSecretKey, getVapidConfig } from "@/lib/env.server";

const KEYS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_SUBJECT",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("server env", () => {
  it("reads the secret key and the legacy service-role name", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service";
    expect(getSupabaseSecretKey()).toBe(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service",
    );

    process.env.SUPABASE_SECRET_KEY = "sb_secret_realvalue";
    expect(getSupabaseSecretKey()).toBe("sb_secret_realvalue");
  });

  it("rejects a placeholder VAPID subject", () => {
    process.env.VAPID_SUBJECT = "mailto:you@example.com";
    process.env.VAPID_PRIVATE_KEY = "private-key-value";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key-value";
    expect(getVapidConfig()).toBeNull();

    process.env.VAPID_SUBJECT = "mailto:isaac@example.edu";
    expect(getVapidConfig()).toEqual({
      subject: "mailto:isaac@example.edu",
      publicKey: "public-key-value",
      privateKey: "private-key-value",
    });
  });
});
