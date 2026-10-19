import { describe, expect, it } from "vitest";

import { firstName } from "@/lib/profile/first-name";
import { friendlyZoneLabel } from "@/lib/time/zones";

describe("friendly zone labels", () => {
  const summer = new Date("2026-07-01T19:00:00Z");

  it("reads Los Angeles as PT", () => {
    expect(friendlyZoneLabel("America/Los_Angeles", summer)).toBe(
      "Los Angeles (PT)",
    );
  });

  it("reads New York as ET", () => {
    expect(friendlyZoneLabel("America/New_York", summer)).toBe("New York (ET)");
  });

  it("leaves UTC as UTC", () => {
    expect(friendlyZoneLabel("UTC", summer)).toBe("UTC");
  });
});

describe("first name", () => {
  it("uses the first word of a display name", () => {
    expect(firstName("Isaac Hsu")).toBe("Isaac");
    expect(firstName("Summer")).toBe("Summer");
    expect(firstName("  ")).toBe("");
  });
});
