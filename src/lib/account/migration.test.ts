import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20270125120000_launch_readiness.sql",
  ),
  "utf8",
);

describe("launch readiness migration", () => {
  it("explains the statements Supabase may flag before any of them run", () => {
    const header = sql.slice(0, sql.indexOf("-- Columns"));
    expect(header).toMatch(/DROP CONSTRAINT letters_to_user_id_fkey/);
    expect(header).toMatch(/ON DELETE SET NULL/);
    expect(header).toMatch(/booth_shots_contributor_fkey/);
    expect(header).toMatch(/do not run when/);
    expect(header).toMatch(/BEFORE UPDATE guards/);
  });

  it("keeps the export bucket private and the destructive work inside functions", () => {
    expect(sql).toMatch(/'exports'[\s\S]*?false/);
    expect(sql).toContain("create function public.leave_circle");
    expect(sql).toContain("create function public.delete_own_account");
    expect(sql).toContain("create function public.purge_archived_circles");
    expect(sql).toContain("create function public.seed_demo_circle");
    expect(sql).not.toMatch(
      /delete from auth\.users[\s\S]{0,80}where account\.id <>/,
    );
  });
});
