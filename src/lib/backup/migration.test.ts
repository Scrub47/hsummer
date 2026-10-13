import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const week6 = readFileSync(
  path.join(root, "supabase/migrations/20261116120000_backup_bucket.sql"),
  "utf8",
);

describe("week 6 migration", () => {
  it("adds a private backups bucket and no client policy", () => {
    expect(week6).toContain("'backups'");
    expect(week6).toContain("false");
    expect(week6).toContain("application/octet-stream");
    expect(week6).toContain("52428800");
    expect(week6).not.toMatch(/create policy/i);
    expect(week6).not.toMatch(/drop table/i);
    expect(week6).not.toMatch(/\bemail\b/);
    expect(week6).not.toMatch(/alter table public\./i);
  });
});
