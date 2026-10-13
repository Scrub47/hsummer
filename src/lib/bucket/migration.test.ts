import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INVITE_WRITE_LIMIT,
  INVITE_WRITE_WINDOW_MINUTES,
} from "@/lib/circles/fields";
import { PING_LIMIT, PING_WINDOW_MINUTES } from "@/lib/pings/fields";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week5 = readFileSync(
  path.join(
    root,
    "supabase/migrations/20261109120000_bucket_items_and_rate_limits.sql",
  ),
  "utf8",
);

const policySection = week5.slice(
  week5.indexOf("-- Policies"),
  week5.indexOf("-- Insert and update guard"),
);

describe("week 5 migration", () => {
  it("adds bucket items without rewriting earlier tables", () => {
    expect(week5).toContain("create table public.bucket_items");
    expect(week5).toContain(
      "category in ('restaurant', 'movie', 'activity', 'date-idea', 'ldr-idea')",
    );
    expect(week5).toContain("status in ('idea', 'planned', 'done')");
    expect(week5).toContain("planned_date date");
    expect(week5).toContain("completed_at timestamptz");
    expect(week5).toContain("on delete set null");
    expect(week5).toContain("replica identity full");
    expect(week5).toContain("supabase_realtime");
    expect(week5).not.toMatch(/drop table/i);
    expect(week5).not.toMatch(/alter table public\.profiles/i);
    expect(week5).not.toMatch(/alter table public\.pings/i);
    expect(week5).not.toMatch(/alter table public\.circles\b/i);
    expect(week5).not.toMatch(/\bemail\b/);
  });

  it("lets every active member read and write, and keeps circle type out", () => {
    expect(policySection).toContain("bucket_items_select_member");
    expect(policySection).toContain("bucket_items_insert_member");
    expect(policySection).toContain("bucket_items_update_member");
    expect(policySection).toContain("bucket_items_delete_member");
    expect(policySection).toContain("private.is_active_member(circle_id)");
    expect(policySection).toContain("created_by = (select auth.uid())");
    expect(policySection).not.toContain("circle_type");
  });

  it("caps new invite rows and serializes redeem attempts", () => {
    expect(week5).toContain("private.circle_invites_guard_insert");
    expect(week5).toContain(`recent >= ${INVITE_WRITE_LIMIT}`);
    expect(week5).toContain(
      `interval '${INVITE_WRITE_WINDOW_MINUTES} minutes'`,
    );
    expect(week5).toContain("hsummer_rate_limited");
    expect(week5).toContain("'invite:' || new.created_by::text");
    expect(week5).toContain("private.join_attempts_guard_insert");
    expect(week5).toContain("'redeem-user:' || new.user_id::text");
    expect(week5).toContain("'redeem-ip:' || new.ip_hash");
    expect(week5).toContain("pg_advisory_xact_lock");
    expect(week5).toContain(
      `${PING_LIMIT} pings per ${PING_WINDOW_MINUTES} minutes`,
    );
  });
});
