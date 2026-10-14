import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("server session helper", () => {
  it("verifies the JWT with getClaims and does not call auth.getSession", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/supabase/session.ts"),
      "utf8",
    );
    expect(source).toContain("supabase.auth.getClaims()");
    expect(source).not.toContain("auth.getSession(");
  });
});
