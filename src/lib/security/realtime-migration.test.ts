import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20270301120000_security_audit_v2.sql",
  ),
  "utf8",
);

function statements(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .toLowerCase();
}

describe("security audit v2 migration", () => {
  it("creates the Live Together policies without taking ownership of realtime.messages", () => {
    const body = statements(sql);
    expect(body).not.toContain("alter table realtime.messages");
    expect(body).not.toMatch(/\bset\s+(local\s+)?role\b/);
    expect(sql).toContain(
      "drop policy if exists together_channel_read on realtime.messages",
    );
    expect(sql).toContain(
      "drop policy if exists together_channel_write on realtime.messages",
    );
    expect(sql).toContain("private.can_join_together_topic(realtime.topic())");
    expect(sql).toContain(
      "grant execute on function private.can_join_together_topic(text) to authenticated",
    );
    expect(sql).toContain(
      "revoke all on function private.can_join_together_topic(text) from public, anon",
    );
    expect(sql).not.toContain(
      "grant execute on function private.can_join_together_topic(text) to anon",
    );
  });

  it("asks the catalog to fail when a channel policy is missing or open", () => {
    expect(sql).toContain("together_channel");
    expect(sql).toContain("realtime_open");
    expect(sql).toContain("definer_search_path");
    expect(sql).toContain("anon_execute");
  });
});
