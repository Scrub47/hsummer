import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

describe("migration RLS", () => {
  it("enables row level security for every public and private table", () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const sql = files
      .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    const tables = [
      ...sql.matchAll(
        /create table(?: if not exists)? (public|private)\.([a-z_]+)/g,
      ),
    ];
    expect(tables.length).toBeGreaterThan(0);

    const missing = tables
      .map((match) => `${match[1]}.${match[2]}`)
      .filter(
        (table) =>
          !sql.includes(`alter table ${table} enable row level security`),
      );

    expect(missing).toEqual([]);
  });

  it("creates the known storage buckets as private", () => {
    const sql = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    for (const bucket of ["avatars", "memories", "backups", "exports"]) {
      const pattern = new RegExp(
        `insert into storage\\.buckets[\\s\\S]*?'${bucket}'[\\s\\S]*?false`,
      );
      expect(sql).toMatch(pattern);
    }
  });
});
