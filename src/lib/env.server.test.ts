import { afterEach, describe, expect, it } from "vitest";

import {
  getCronSecret,
  getQstashConfig,
  getSentryDsn,
  getSupabaseSecretKey,
  getUpstashConfig,
  getVapidConfig,
} from "@/lib/env.server";

const KEYS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_SUBJECT",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "CRON_SECRET",
  "SENTRY_DSN",
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

  it("treats Upstash as optional and ignores placeholders", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(getUpstashConfig()).toBeNull();

    process.env.UPSTASH_REDIS_REST_URL = "https://your-upstash-url.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "your-upstash-token";
    expect(getUpstashConfig()).toBeNull();

    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "real-token-value";
    expect(getUpstashConfig()).toEqual({
      url: "https://example.upstash.io",
      token: "real-token-value",
    });
  });

  it("treats QStash as optional until the token and both signing keys are set", () => {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    expect(getQstashConfig()).toBeNull();

    process.env.QSTASH_TOKEN = "your-qstash-token";
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current-signing-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next-signing-key";
    expect(getQstashConfig()).toBeNull();

    process.env.QSTASH_TOKEN = "qstash-token-value";
    expect(getQstashConfig()).toEqual({
      token: "qstash-token-value",
      currentSigningKey: "current-signing-key",
      nextSigningKey: "next-signing-key",
    });
  });

  it("requires a long cron secret and an https Sentry DSN", () => {
    delete process.env.CRON_SECRET;
    delete process.env.SENTRY_DSN;
    expect(getCronSecret()).toBeNull();
    expect(getSentryDsn()).toBeNull();

    process.env.CRON_SECRET = "short";
    process.env.SENTRY_DSN = "http://key@example.invalid/1";
    expect(getCronSecret()).toBeNull();
    expect(getSentryDsn()).toBeNull();

    process.env.CRON_SECRET = "cron-secret-value";
    process.env.SENTRY_DSN = "https://public@example.invalid/1";
    expect(getCronSecret()).toBe("cron-secret-value");
    expect(getSentryDsn()).toBe("https://public@example.invalid/1");
  });
});
