import { describe, expect, it } from "vitest";

import {
  countdownWriteFailure,
  parseCheckpointDraft,
  parseCountdownDraft,
} from "@/lib/countdowns/fields";

describe("parseCountdownDraft", () => {
  it("defaults the label to Still Us", () => {
    expect(
      parseCountdownDraft({ label: "  ", targetDate: "2027-02-14" }),
    ).toEqual({
      ok: true,
      value: { label: "Still Us", targetDate: "2027-02-14" },
    });
  });

  it("rejects a date that is not a real day", () => {
    const parsed = parseCountdownDraft({
      label: "Winter",
      targetDate: "2027-02-31",
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("parseCheckpointDraft", () => {
  it("accepts auto-by-date and manual", () => {
    expect(
      parseCheckpointDraft({
        label: "Flight booked",
        date: "2027-01-04",
        trigger: "manual",
      }).ok,
    ).toBe(true);
    expect(
      parseCheckpointDraft({
        label: "100 days",
        date: "2026-11-06",
        trigger: "auto-by-date",
      }).ok,
    ).toBe(true);
    expect(
      parseCheckpointDraft({
        label: "Soon",
        date: "2027-01-04",
        trigger: "broadcast",
      }).ok,
    ).toBe(false);
  });
});

describe("countdownWriteFailure", () => {
  it("explains the couple's one countdown", () => {
    expect(countdownWriteFailure("hsummer_countdown_couple", "P0001")).toMatch(
      /one countdown/i,
    );
  });
});
