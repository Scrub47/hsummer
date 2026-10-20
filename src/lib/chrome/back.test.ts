import { describe, expect, it } from "vitest";

import { backTarget } from "@/lib/chrome/back";

describe("back target", () => {
  it("uses history when there is somewhere to return to", () => {
    expect(
      backTarget({
        historyLength: 2,
        hash: "#memory-heading",
        pathname: "/circles/abc",
        search: "",
        fallback: "/circles",
      }),
    ).toEqual({ kind: "back" });
  });

  it("falls back from a feature hash to the circle home", () => {
    expect(
      backTarget({
        historyLength: 1,
        hash: "#letters-heading",
        pathname: "/circles/abc",
        search: "",
        fallback: "/circles",
      }),
    ).toEqual({ kind: "replace", href: "/circles/abc" });
  });

  it("falls back to the parent route from a circle home or settings", () => {
    expect(
      backTarget({
        historyLength: 1,
        hash: "",
        pathname: "/circles/abc",
        search: "",
        fallback: "/circles",
      }),
    ).toEqual({ kind: "replace", href: "/circles" });
    expect(
      backTarget({
        historyLength: 1,
        hash: "",
        pathname: "/profile/settings",
        search: "",
        fallback: "/profile",
      }),
    ).toEqual({ kind: "replace", href: "/profile" });
  });
});
