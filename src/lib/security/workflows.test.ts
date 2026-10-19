import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflows = ["ci.yml", "db-backup.yml"].map((name) =>
  readFileSync(path.join(process.cwd(), ".github/workflows", name), "utf8"),
);

const sha =
  /uses: actions\/(?:checkout|setup-node)@[0-9a-f]{40} # v\d+\.\d+\.\d+/;

describe("GitHub Actions", () => {
  it("pins checkout and setup-node and keeps the token read-only", () => {
    for (const workflow of workflows) {
      expect(workflow).toMatch(/permissions:\n {2}contents: read/);
      expect(workflow).toMatch(sha);
      expect(workflow).toContain(
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      );
      expect(workflow).toContain(
        "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
      );
      expect(workflow).not.toMatch(
        /uses: actions\/(?:checkout|setup-node)@v\d/,
      );
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
