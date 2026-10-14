import { describe, expect, it } from "vitest";

import {
  daysLabel,
  daysUntil,
  parseDeliveryChoice,
  scheduleInstant,
  zonedLocalToUtc,
} from "@/lib/schedule/time";

describe("daysUntil", () => {
  it("counts calendar days in the viewer's timezone", () => {
    const now = new Date("2026-10-15T06:30:00.000Z");
    expect(daysUntil("2026-10-15", "UTC", now)).toBe(0);
    expect(daysUntil("2026-10-14", "America/Los_Angeles", now)).toBe(0);
    expect(daysUntil("2026-10-15", "America/Los_Angeles", now)).toBe(1);
    expect(daysUntil("2026-10-13", "America/Los_Angeles", now)).toBe(-1);
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(0)).toBe("Today");
    expect(daysLabel(-3)).toBe("3 days ago");
  });
});

describe("zonedLocalToUtc", () => {
  it("turns 8:00 AM in Los Angeles into the right UTC instant", () => {
    const winter = zonedLocalToUtc(
      "2027-02-14",
      "08:00",
      "America/Los_Angeles",
    );
    expect(winter?.toISOString()).toBe("2027-02-14T16:00:00.000Z");

    const summer = zonedLocalToUtc(
      "2026-07-14",
      "08:00",
      "America/Los_Angeles",
    );
    expect(summer?.toISOString()).toBe("2026-07-14T15:00:00.000Z");
  });

  it("refuses a time that the spring-forward gap skips", () => {
    expect(
      zonedLocalToUtc("2026-03-08", "02:30", "America/Los_Angeles"),
    ).toBeNull();
  });
});

describe("scheduleInstant", () => {
  const now = new Date("2026-10-14T15:00:00.000Z");

  it("treats a missing choice as deliver now", () => {
    expect(parseDeliveryChoice({ when: null, date: "", time: "" })).toEqual({
      ok: true,
      value: { when: "now" },
    });
  });

  it("keeps a later time that is at least a minute ahead", () => {
    const parsed = parseDeliveryChoice({
      when: "later",
      date: "2027-02-14",
      time: "08:00",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.when !== "later") return;
    const instant = scheduleInstant({
      date: parsed.value.date,
      time: parsed.value.time,
      timeZone: "America/Los_Angeles",
      now,
    });
    expect(instant).toEqual({
      ok: true,
      value: "2027-02-14T16:00:00.000Z",
    });
  });

  it("refuses a time that is already this minute", () => {
    const instant = scheduleInstant({
      date: "2026-10-14",
      time: "08:00",
      timeZone: "America/Los_Angeles",
      now,
    });
    expect(instant.ok).toBe(false);
  });
});
