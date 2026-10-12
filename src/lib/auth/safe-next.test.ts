import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next";

const origin = "https://hsummer.example";

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/home", origin)).toBe("/home");
    expect(safeNextPath("/home?tab=notifications", origin)).toBe(
      "/home?tab=notifications",
    );
  });

  it("rejects open redirects", () => {
    expect(safeNextPath("https://evil.example/phish", origin)).toBe("/home");
    expect(safeNextPath("//evil.example/phish", origin)).toBe("/home");
    expect(safeNextPath(null, origin)).toBe("/home");
  });
});
