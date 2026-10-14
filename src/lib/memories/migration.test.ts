import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MEMORY_LIMIT,
  MEMORY_MAX_BYTES,
  MEMORY_QUOTA_BYTES,
  MEMORY_WINDOW_MINUTES,
} from "@/lib/memories/fields";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week8 = readFileSync(
  path.join(root, "supabase/migrations/20261130120000_memories.sql"),
  "utf8",
);

describe("week 8 migration", () => {
  it("adds memories, viewers, and the private bucket without rewriting earlier tables", () => {
    expect(week8).toContain("create table public.memories");
    expect(week8).toContain("create table public.memory_viewers");
    expect(week8).toContain("insert into storage.buckets");
    expect(week8).toContain("'memories'");
    expect(week8).toContain("false");
    expect(week8).toContain(String(MEMORY_MAX_BYTES));
    expect(week8).toContain(String(MEMORY_QUOTA_BYTES));
    expect(week8).toContain("replica identity full");
    expect(week8).toContain("supabase_realtime");
    expect(week8).not.toMatch(/drop table/i);
    expect(week8).not.toMatch(/alter table public\.profiles/i);
    expect(week8).not.toMatch(/alter table public\.bucket_items/i);
    expect(week8).not.toMatch(/alter table public\.current_moods/i);
    expect(week8).not.toMatch(/alter table public\.circles\b/i);
    expect(week8).not.toMatch(/\bemail\b/);
  });

  it("splits circle and selected visibility and keeps circle type out of the policies", () => {
    const policies = week8.slice(week8.indexOf("-- Policies"));
    expect(policies).toContain("memories_select_visible");
    expect(policies).toContain("private.is_memory_viewer(id)");
    expect(policies).toContain("private.can_read_memory(memory.id)");
    expect(policies).toContain("visibility = 'circle'");
    expect(policies).toContain("public.memory_viewers");
    expect(policies).toContain("memories_insert_member");
    expect(policies).toContain("memories_update_author");
    expect(policies).toContain("memories_delete_author");
    expect(policies).toContain("memory_viewers_insert_author");
    expect(policies).toContain("private.is_active_member(circle_id)");
    expect(policies).not.toContain("circle_type");
  });

  it("caps storage, strips the object on delete, and rate limits inserts", () => {
    expect(week8).toContain("private.memories_guard");
    expect(week8).toContain("hsummer_rate_limited");
    expect(week8).toContain("hsummer_storage_quota");
    expect(week8).toContain(`recent >= ${MEMORY_LIMIT}`);
    expect(week8).toContain(`interval '${MEMORY_WINDOW_MINUTES} minutes'`);
    expect(week8).toContain("private.memories_remove_photo");
    expect(week8).toContain("private.memories_object_quota");
    expect(week8).toContain("memories_objects_select_visible");
    expect(week8).toContain("memories_objects_insert_author");
    expect(week8).toContain("array['image/jpeg', 'image/png', 'image/webp']");
    expect(week8).toContain("public.circle_memory_bytes");
  });
});
