import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20270318120000_part_two.sql"),
  "utf8",
);

describe("part 2 migration", () => {
  it("adds the new tables idempotently and turns on row level security", () => {
    for (const table of [
      "letter_pins",
      "reactions",
      "replies",
      "held_notifications",
    ]) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated`,
      );
    }
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("replaces policies and functions so the file can be pasted twice", () => {
    expect(sql).toContain("drop policy if exists letter_pins_select_own");
    expect(sql).toContain("drop policy if exists reactions_select_visible");
    expect(sql).toContain("drop policy if exists replies_select_visible");
    expect(sql).toContain("create or replace function private.can_read_letter");
    expect(sql).toContain(
      "create or replace function public.recipient_quiet_status",
    );
    expect(sql).toContain("drop trigger if exists reactions_guard");
    expect(sql).toContain("drop trigger if exists replies_guard");
  });

  it("locks security definer functions to an empty search path and denies anon", () => {
    const definers = sql.split("security definer").length - 1;
    expect(definers).toBeGreaterThanOrEqual(5);
    expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(
      definers,
    );
    expect(sql).toContain(
      "drop function if exists public.recipient_quiet_status(uuid)",
    );
    expect(sql).toContain(
      "drop function if exists public.recipient_quiet_status(uuid, timestamptz)",
    );
    expect(sql).toContain(
      "revoke all on function public.recipient_quiet_status(uuid, timestamptz)",
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).not.toContain(
      "grant execute on function public.recipient_quiet_status(uuid, timestamptz) to anon",
    );
  });

  it("keeps reactions and replies to people who can see the item, with a rate limit", () => {
    expect(sql).toContain(
      "private.can_respond_to(target_kind, target_id, circle_id)",
    );
    expect(sql).toContain("recent >= 30");
    expect(sql).toContain("recent >= 20");
    expect(sql).toContain("hsummer_rate_limited");
    expect(sql).toContain("position('@' in body) = 0");
    expect(sql).not.toContain(
      "grant select on table public.held_notifications to authenticated",
    );
  });
});
