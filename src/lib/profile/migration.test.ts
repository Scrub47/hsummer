import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week2 = readFileSync(
  path.join(
    root,
    "supabase/migrations/20261019120000_account_private_and_avatars.sql",
  ),
  "utf8",
);

describe("week 2 migration", () => {
  it("adds account_private and the avatar bucket without an email column", () => {
    expect(week2).toContain("create table public.account_private");
    expect(week2).toContain("private.can_read_profile");
    expect(week2).toContain("Week 3");
    expect(week2).toContain("circle_members");
    expect(week2).toContain("'avatars'");
    expect(week2).toContain("false");
    expect(week2).not.toMatch(/drop table public\.profiles/i);
    expect(week2).not.toMatch(/drop policy profiles_update_own/i);

    const table = /create table public\.account_private \(([\s\S]*?)\);/.exec(
      week2,
    );
    expect(table?.[1]).toBeTruthy();
    expect(table?.[1]).not.toMatch(/\bemail\b/);
  });
});
