import { describe, expect, it } from "vitest";

import {
  assertBackupProjectUrl,
  assertDumpConnection,
  assertPassphrase,
  backupObjectName,
  backupObjectsToDelete,
  backupUploadFailure,
  ensureSslMode,
} from "../../../scripts/backup-lib.mjs";

const session =
  "postgresql://postgres.abcdefghijklmnop:s3cret-password@aws-0-us-west-2.pooler.supabase.com:5432/postgres";

describe("dump connection", () => {
  it("accepts the Oregon session pooler on port 5432", () => {
    expect(assertDumpConnection(session)).toEqual({
      ok: true,
      host: "aws-0-us-west-2.pooler.supabase.com",
      port: 5432,
    });
    expect(assertDumpConnection(`${session}?sslmode=require`).ok).toBe(true);
  });

  it("rejects the transaction pooler, the direct host, and the wrong region", () => {
    const transaction = assertDumpConnection(
      "postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-us-west-2.pooler.supabase.com:6543/postgres",
    );
    expect(transaction.ok).toBe(false);
    if (!transaction.ok) expect(transaction.error).toMatch(/6543/);

    const direct = assertDumpConnection(
      "postgresql://postgres:s3cret@db.abcdefghijklmnop.supabase.co:5432/postgres",
    );
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.error).toMatch(/IPv6/);

    const east = assertDumpConnection(
      "postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    );
    expect(east.ok).toBe(false);
    if (!east.ok) expect(east.error).toMatch(/us-west-2/);
  });

  it("rejects a missing password and a placeholder", () => {
    const missing = assertDumpConnection(
      "postgresql://postgres.abcdefghijklmnop@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    );
    expect(missing.ok).toBe(false);
    const placeholder = assertDumpConnection(
      "postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
    );
    expect(placeholder.ok).toBe(false);
    if (!placeholder.ok) expect(placeholder.error).toMatch(/Database/);
  });
});

describe("backup objects", () => {
  it("names a dump so the oldest sorts first", () => {
    const name = backupObjectName(
      new Date("2026-11-16T11:00:00.000Z"),
      "abcd1234",
    );
    expect(name).toBe("hsummer-20261116T110000Z-abcd1234.tgz.gpg");
  });

  it("keeps the latest eight dumps and ignores other names", () => {
    const names = [];
    for (let day = 1; day <= 9; day += 1) {
      const date = new Date(Date.UTC(2026, 10, day, 11, 0, 0));
      names.push(backupObjectName(date, "abcd1234"));
    }
    names.push(".emptyFolderPlaceholder");
    names.push("notes.txt");
    const stale = backupObjectsToDelete(names);
    expect(stale).toEqual([
      backupObjectName(new Date(Date.UTC(2026, 10, 1, 11, 0, 0)), "abcd1234"),
    ]);
    expect(backupObjectsToDelete(names.slice(0, 8))).toEqual([]);
  });
});

describe("upload target", () => {
  it("accepts the project origin and rejects a database URI", () => {
    expect(assertBackupProjectUrl("https://abcd.supabase.co")).toEqual({
      ok: true,
      url: "https://abcd.supabase.co",
    });
    expect(
      assertBackupProjectUrl(
        "postgresql://postgres.abcd:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres",
      ).ok,
    ).toBe(false);
    expect(assertBackupProjectUrl("http://127.0.0.1:54321").ok).toBe(false);
  });

  it("asks for the SQL file when the bucket is missing", () => {
    expect(backupUploadFailure("Bucket not found")).toMatch(
      /20261116120000_backup_bucket\.sql/,
    );
    expect(assertPassphrase("short").ok).toBe(false);
    expect(assertPassphrase("a-long-passphrase").ok).toBe(true);
  });

  it("adds sslmode without disturbing a string that already has it", () => {
    expect(ensureSslMode(session)).toBe(`${session}?sslmode=require`);
    expect(ensureSslMode(`${session}?sslmode=require`)).toBe(
      `${session}?sslmode=require`,
    );
    expect(ensureSslMode(`${session}?connect_timeout=10`)).toBe(
      `${session}?connect_timeout=10&sslmode=require`,
    );
  });
});
