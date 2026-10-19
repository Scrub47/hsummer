import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20271020120000_feedback.sql"),
  "utf8",
);

describe("feedback migration", () => {
  it("is insert-only, later than the ping purge, and has no email column", () => {
    expect("20271020120000" > "20271019120000").toBe(true);
    expect(sql).toContain("create table if not exists public.feedback");
    expect(sql).toContain(
      "alter table public.feedback enable row level security",
    );
    expect(sql).toContain("for insert");
    expect(sql).not.toMatch(/on public\.feedback\s+for select/i);
    expect(sql).toContain(
      "grant insert on table public.feedback to authenticated",
    );
    expect(sql).toContain(
      "grant select on table public.feedback to service_role",
    );
    const table =
      /create table if not exists public\.feedback \(([\s\S]*?)\);/.exec(sql);
    expect(table?.[1]).toBeTruthy();
    expect(table?.[1]).not.toMatch(/\bemail\b/);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("hsummer_feedback_rate_limited");
    expect(sql).toContain("analytics_opt_out");
    expect(sql).toContain("feedback_prompt_dismissed_at");
  });
});
