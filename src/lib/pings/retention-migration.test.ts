import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PING_RETENTION_DAYS } from "@/lib/pings/fields";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20271019120000_purge_expired_pings.sql",
  ),
  "utf8",
);

describe("Thinking of You retention migration", () => {
  it("deletes by a passed cutoff and leaves row level security alone", () => {
    expect(PING_RETENTION_DAYS).toBe(3);
    expect(sql).toContain(
      "create or replace function public.purge_expired_pings(cutoff timestamptz)",
    );
    expect(sql).toContain("ping.ping_type = 'thinking-of-you'");
    expect(sql).toContain("ping.sent_at < cutoff");
    expect(sql).toContain("not private.circle_is_demo(ping.circle_id)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("if (select auth.uid()) is not null");
    expect(sql).toContain(
      "revoke all on function public.purge_expired_pings(timestamptz)",
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain(
      "grant execute on function public.purge_expired_pings(timestamptz) to service_role",
    );
    expect(sql).not.toMatch(/interval '3 days'/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant delete/i);
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });
});
