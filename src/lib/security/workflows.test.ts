import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflows = ["ci.yml", "db-backup.yml"].map((name) =>
  readFileSync(path.join(process.cwd(), ".github/workflows", name), "utf8"),
);

const sha = /uses: actions\/(?:checkout|setup-node)@[0-9a-f]{40} # v4\.4\.0/;

describe("GitHub Actions", () => {
  it("pins checkout and setup-node and keeps the token read-only", () => {
    for (const workflow of workflows) {
      expect(workflow).toMatch(/permissions:\n {2}contents: read/);
      expect(workflow).toMatch(sha);
      expect(workflow).not.toMatch(/uses: actions\/checkout@v4\b/);
      expect(workflow).not.toMatch(/uses: actions\/setup-node@v4\b/);
    }
  });

  it("checks the gitleaks download before installing it", () => {
    const ci = workflows[0] ?? "";
    expect(ci).toContain(
      "79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e",
    );
    expect(ci).toContain("sha256sum -c -");
  });
});
