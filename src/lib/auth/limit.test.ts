import { describe, expect, it } from "vitest";

import {
  authEmailBucket,
  authIpBucket,
  decideAuthLimit,
} from "@/lib/auth/limit";

describe("decideAuthLimit", () => {
  it("trusts Upstash when Upstash enforced the window", () => {
    expect(
      decideAuthLimit({
        upstashEnforced: true,
        databaseAllowed: null,
        production: true,
      }),
    ).toEqual({ ok: true });
  });

  it("uses Postgres when Upstash is not the enforcer", () => {
    expect(
      decideAuthLimit({
        upstashEnforced: false,
        databaseAllowed: false,
        production: false,
      }),
    ).toEqual({ ok: false, reason: "limited" });
    expect(
      decideAuthLimit({
        upstashEnforced: false,
        databaseAllowed: true,
        production: true,
      }),
    ).toEqual({ ok: true });
  });

  it("fails closed in production when neither limiter can answer", () => {
    expect(
      decideAuthLimit({
        upstashEnforced: false,
        databaseAllowed: null,
        production: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      decideAuthLimit({
        upstashEnforced: false,
        databaseAllowed: null,
        production: false,
      }),
    ).toEqual({ ok: true });
  });
});

describe("auth buckets", () => {
  it("hashes the email and keeps the bucket shape the SQL check allows", () => {
    const email = authEmailBucket("Summer@Example.com");
    const ip = authIpBucket("magic", "a".repeat(64));
    expect(email).toMatch(/^auth:magic:email:[0-9a-f]{64}$/);
    expect(authEmailBucket("summer@example.com")).toBe(email);
    expect(ip).toMatch(/^auth:magic:ip:a{64}$/);
    expect(email).not.toContain("Summer");
  });
});
