import { describe, expect, it } from "vitest";

import { featureFromHash, featureHash } from "@/lib/circles/feature-tabs";

describe("circle feature hashes", () => {
  it("treats an empty hash as the circle home", () => {
    expect(featureFromHash("")).toBeNull();
    expect(featureFromHash("#")).toBeNull();
  });

  it("maps shortcut hashes onto feature ids", () => {
    expect(featureFromHash("#memory-heading")).toBe("memory");
    expect(featureFromHash("letters-heading")).toBe("letters");
    expect(featureFromHash("#ping")).toBe("ping");
    expect(featureHash("memory")).toBe("memory-heading");
    expect(featureHash("home")).toBeNull();
  });
});
