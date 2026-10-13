import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PING_LIMIT, PING_WINDOW_MINUTES } from "@/lib/pings/fields";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week4 = readFileSync(
  path.join(root, "supabase/migrations/20261102120000_pings.sql"),
  "utf8",
);

const policySection = week4.slice(
  week4.indexOf("-- Policies"),
  week4.indexOf("-- Insert guard"),
);

describe("week 4 migration", () => {
  it("adds pings without touching earlier tables", () => {
    expect(week4).toContain("create table public.pings");
    expect(week4).toContain("from_user_id uuid references public.profiles");
    expect(week4).toContain("to_user_id uuid references public.profiles");
    expect(week4).toContain("on delete set null");
    expect(week4).toContain("on delete cascade");
    expect(week4).toContain("secret_variant boolean not null default false");
    expect(week4).toContain("private.is_active_member_user");
    expect(week4).not.toMatch(/drop table/i);
    expect(week4).not.toMatch(/alter table public\.profiles/i);
    expect(week4).not.toMatch(/alter table public\.push_subscriptions/i);
    expect(week4).not.toMatch(/alter table public\.circles/i);
    expect(week4).not.toMatch(/\bemail\b/);
  });

  it("keeps circle type out of the policies and allows a null recipient there", () => {
    expect(policySection).toContain("pings_select_parties");
    expect(policySection).toContain("pings_insert_sender");
    expect(policySection).toContain("from_user_id = (select auth.uid())");
    expect(policySection).toContain("to_user_id = (select auth.uid())");
    expect(policySection).toContain("or to_user_id is null");
    expect(policySection).toContain("private.is_active_member(circle_id)");
    expect(policySection).not.toContain("circle_type");
    expect(policySection).not.toMatch(/for update/i);
    expect(policySection).not.toMatch(/for delete/i);
  });

  it("rejects a couple broadcast and rate-limits sends in the trigger", () => {
    const guard = week4.slice(week4.indexOf("-- Insert guard"));
    expect(guard).toContain("found_type = 'couple'");
    expect(guard).toContain("hsummer_couple_needs_recipient");
    expect(guard).toContain("hsummer_rate_limited");
    expect(guard).toContain(`recent >= ${PING_LIMIT}`);
    expect(guard).toContain(`interval '${PING_WINDOW_MINUTES} minutes'`);
    expect(guard).toContain("new.sent_at := pg_catalog.now()");
    expect(guard).toContain("pg_advisory_xact_lock");
    expect(week4).not.toMatch(/grant update/i);
    expect(week4).not.toMatch(/grant delete/i);
  });
});
