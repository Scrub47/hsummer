import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week3 = readFileSync(
  path.join(root, "supabase/migrations/20261026120000_circles_and_invites.sql"),
  "utf8",
);

const policySection = week3.slice(
  week3.indexOf("-- Policies"),
  week3.indexOf("-- Rate limit ledger"),
);

const inviteGrant =
  /grant select \(([\s\S]*?)\) on table public\.circle_invites/.exec(week3);

describe("week 3 migration", () => {
  it("adds the circle tables and the membership helper", () => {
    expect(week3).toContain("create table public.circles");
    expect(week3).toContain("create table public.circle_members");
    expect(week3).toContain("create table public.circle_invites");
    expect(week3).toContain("create table public.circle_invite_redemptions");
    expect(week3).toContain("private.is_active_member");
    expect(week3).toContain("left_at is null");
    expect(week3).toContain("private.hash_invite_token");
    expect(week3).toContain("public.redeem_invite");
    expect(week3).toContain("public.create_circle");
    expect(week3).not.toMatch(/drop table public\.profiles/i);
    expect(week3).not.toMatch(/drop table public\.account_private/i);
  });

  it("widens profile reads inside can_read_profile and not anywhere else", () => {
    expect(week3).toContain(
      "create or replace function private.can_read_profile",
    );
    expect(week3).toContain("from public.circle_members me");
    expect(week3).toContain("them.user_id = profile_id");
    expect(week3).not.toMatch(/create policy account_private/i);
    expect(policySection).not.toContain("account_private");
    expect(policySection).not.toContain("circle_type");
    expect(policySection).toContain("private.is_active_member");
  });

  it("stores a hash, hides it from clients, and rate-limits redemption", () => {
    expect(week3).toContain("token_hash text not null");
    expect(inviteGrant?.[1]).toBeTruthy();
    expect(inviteGrant?.[1]).not.toContain("token_hash");
    expect(week3).toContain("user_hits > 8");
    expect(week3).toContain("ip_hits > 20");
    expect(week3).toContain("interval '15 minutes'");
    expect(week3).toContain("private.join_attempts");

    const tables = week3.slice(0, week3.indexOf("-- Helpers"));
    expect(tables).not.toMatch(/\bemail\b/);
  });
});
