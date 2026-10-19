import { describe, expect, it } from "vitest";

import {
  allowsKind,
  formatResumeLabel,
  isQuietMinute,
  parsePrefs,
  quietDecision,
  quietNotice,
} from "@/lib/settings/prefs";

describe("notification prefs", () => {
  it("turns notifications on and sounds off when the column is empty", () => {
    const prefs = parsePrefs({});
    expect(prefs.pings).toBe(true);
    expect(prefs.sounds).toBe(false);
    expect(prefs.theme).toBe("system");
    expect(prefs.quiet.enabled).toBe(false);
    expect(prefs.quiet.end).toBe("08:00");
  });

  it("drops a broken clock and a theme that is not one of the three", () => {
    const prefs = parsePrefs({
      theme: "burgundy",
      sounds: true,
      quiet: { enabled: true, start: "25:00", end: "8" },
    });
    expect(prefs.theme).toBe("system");
    expect(prefs.sounds).toBe(true);
    expect(prefs.quiet.start).toBe("22:00");
    expect(prefs.quiet.end).toBe("08:00");
  });

  it("requires the group toggle for a group circle and not for a couple", () => {
    const prefs = parsePrefs({ group: false, letters: true, pings: true });
    expect(allowsKind(prefs, "letters", "group")).toBe(false);
    expect(allowsKind(prefs, "pings", "couple")).toBe(true);
    expect(allowsKind(prefs, "pings", "friends")).toBe(false);
  });
});

describe("quiet hours", () => {
  it("holds an overnight window and names 8 AM", () => {
    const prefs = parsePrefs({
      quiet: { enabled: true, start: "22:00", end: "08:00" },
    });
    const evening = quietDecision({
      prefs,
      timeZone: "UTC",
      now: new Date("2026-10-19T23:30:00.000Z"),
    });
    expect(evening.inQuiet).toBe(true);
    expect(evening.resumeLabel).toBe("8 AM");
    expect(evening.deliverAt).toBe("2026-10-20T08:00:00.000Z");
    expect(quietNotice("Summer", evening.resumeLabel ?? "")).toBe(
      "Summer's in quiet hours, we'll deliver it at 8 AM",
    );

    const morning = quietDecision({
      prefs,
      timeZone: "UTC",
      now: new Date("2026-10-20T07:15:00.000Z"),
    });
    expect(morning.inQuiet).toBe(true);
    expect(morning.deliverAt).toBe("2026-10-20T08:00:00.000Z");

    const day = quietDecision({
      prefs,
      timeZone: "UTC",
      now: new Date("2026-10-20T12:00:00.000Z"),
    });
    expect(day.inQuiet).toBe(false);
  });

  it("uses the recipient's zone, not UTC", () => {
    const prefs = parsePrefs({
      quiet: { enabled: true, start: "22:00", end: "08:00" },
    });
    const decision = quietDecision({
      prefs,
      timeZone: "America/Los_Angeles",
      now: new Date("2026-10-20T06:30:00.000Z"),
    });
    expect(decision.inQuiet).toBe(true);
    expect(decision.resumeLabel).toBe("8 AM");
    expect(decision.deliverAt).toBe("2026-10-20T15:00:00.000Z");
  });

  it("formats half hours and treats a zero-length window as off", () => {
    expect(formatResumeLabel("00:00")).toBe("12 AM");
    expect(formatResumeLabel("12:30")).toBe("12:30 PM");
    expect(isQuietMinute(60, 60, 60)).toBe(false);
  });
});
