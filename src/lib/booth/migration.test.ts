import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week13 = readFileSync(
  path.join(root, "supabase/migrations/20270104120000_solo_booth.sql"),
  "utf8",
);

describe("week 13 migration", () => {
  it("adds the booth tables and a private-bucket policy without a new bucket", () => {
    expect(week13).toContain("create table public.booth_sessions");
    expect(week13).toContain("create table public.booth_contributors");
    expect(week13).toContain("create table public.booth_shots");
    expect(week13).toContain("public.save_solo_booth");
    expect(week13).toContain("enable row level security");
    expect(week13).toContain("booth_objects_select_member");
    expect(week13).toContain("booth_objects_insert_author");
    expect(week13).toContain("private.can_read_booth_object");
    expect(week13).not.toMatch(/insert into storage\.buckets/i);
    expect(week13).not.toMatch(/drop table/i);
    expect(week13).not.toMatch(/drop column/i);
    expect(week13).not.toContain("circle_type");
  });

  it("replaces the memory checks without deleting rows, and says so", () => {
    expect(week13).toContain("drop constraint memories_kind_known");
    expect(week13).toContain("drop constraint memories_photo_shape");
    expect(week13).toContain("'photo-strip'");
    expect(week13).toContain("does not delete memories");
    expect(week13).toContain(
      "CREATE OR REPLACE FUNCTION replaces memories_guard",
    );
    expect(week13).toContain("revoke all on table public.booth_sessions");
    expect(week13).toContain(
      "grant select on table public.booth_sessions to authenticated",
    );
    expect(week13).toContain(
      "grant execute on function public.save_solo_booth",
    );
    expect(week13).not.toMatch(/grant insert on table public\.booth_sessions/i);
  });

  it("keeps solo save in one transaction and counts the frames toward the quota", () => {
    expect(week13).toContain("hsummer.booth_save");
    expect(week13).toContain("kind = 'photo-strip'");
    expect(week13).toContain("104857600");
    expect(week13).toContain("recent >= 10");
    expect(week13).toContain("private.booth_shots_remove_object");
    expect(week13).toContain("mode = 'solo'");
    expect(week13).toContain("theme in ('kawaii', 'minimal')");
  });
});
