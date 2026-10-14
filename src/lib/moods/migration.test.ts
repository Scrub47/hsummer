import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MOODS } from "@/lib/moods/fields";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week7 = readFileSync(
  path.join(root, "supabase/migrations/20261123120000_current_moods.sql"),
  "utf8",
);

const policySection = week7.slice(
  week7.indexOf("-- Policies"),
  week7.indexOf("-- Upsert guard"),
);

describe("week 7 migration", () => {
  it("adds current moods without rewriting earlier tables", () => {
    expect(week7).toContain("create table public.current_moods");
    expect(week7).toContain("primary key (user_id, circle_id)");
    expect(week7).toContain("replica identity full");
    expect(week7).toContain("supabase_realtime");
    expect(week7).toContain("current_moods");
    expect(week7).not.toMatch(/drop table/i);
    expect(week7).not.toMatch(/alter table public\.profiles/i);
    expect(week7).not.toMatch(/alter table public\.pings/i);
    expect(week7).not.toMatch(/alter table public\.bucket_items/i);
    expect(week7).not.toMatch(/alter table public\.circles\b/i);
    expect(week7).not.toMatch(/\bemail\b/);
    for (const mood of MOODS) {
      expect(week7).toContain(`'${mood.emoji}'`);
    }
  });

  it("lets members read and only the owner write, and keeps circle type out", () => {
    expect(policySection).toContain("current_moods_select_members");
    expect(policySection).toContain("current_moods_insert_own");
    expect(policySection).toContain("current_moods_update_own");
    expect(policySection).toContain("current_moods_delete_own");
    expect(policySection).toContain("private.is_active_member(circle_id)");
    expect(policySection).toContain(
      "private.is_active_member_user(circle_id, user_id)",
    );
    expect(policySection).toContain("user_id = (select auth.uid())");
    expect(policySection).not.toContain("circle_type");
    expect(
      policySection.match(/user_id = \(select auth\.uid\(\)\)/g),
    ).toHaveLength(4);
  });

  it("stamps updated_at and refuses moving the row", () => {
    expect(week7).toContain("private.current_moods_guard");
    expect(week7).toContain("hsummer_mood_locked");
    expect(week7).toContain("hsummer_mood_not_owner");
    expect(week7).toContain("new.updated_at := pg_catalog.now()");
    expect(week7).toContain("grant update (user_id, circle_id, emoji)");
  });
});
