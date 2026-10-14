import { describe, expect, it } from "vitest";

import {
  MEMORY_LIMIT,
  MEMORY_MAX_BYTES,
  MEMORY_QUOTA_BYTES,
  MEMORY_QUOTA_MESSAGE,
  MEMORY_RATE_LIMIT_MESSAGE,
  MEMORY_SIGNED_URL_SECONDS,
  MEMORY_WINDOW_MINUTES,
  calendarDate,
  formatMemoryUsage,
  formatMonth,
  isDisplayableMemoryUrl,
  memoryPhotoPath,
  memoryWriteFailure,
  parseMemoryForm,
  parseOccurredOn,
  parseTags,
} from "@/lib/memories/fields";

const now = new Date("2026-10-14T18:00:00.000Z");
const circleId = "11111111-1111-4111-8111-111111111111";
const partnerId = "33333333-3333-4333-8333-333333333333";

describe("memory field rules", () => {
  it("keeps the quota, the rate limit, and the signed-url lifetime short", () => {
    expect(MEMORY_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(MEMORY_QUOTA_BYTES).toBe(100 * 1024 * 1024);
    expect(MEMORY_LIMIT).toBe(10);
    expect(MEMORY_WINDOW_MINUTES).toBe(10);
    expect(MEMORY_SIGNED_URL_SECONDS).toBe(5 * 60);
    expect(MEMORY_SIGNED_URL_SECONDS).toBeLessThanOrEqual(15 * 60);
  });

  it("parses tags and rejects an address", () => {
    const tags = parseTags(" Summer, ferry, summer ");
    expect(tags.ok).toBe(true);
    if (!tags.ok) return;
    expect(tags.value).toEqual(["summer", "ferry"]);
    const empty = parseTags("");
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.value).toEqual([]);
    expect(parseTags("ada@example.com").ok).toBe(false);
    expect(parseTags("a".repeat(25)).ok).toBe(false);
    expect(
      parseTags(Array.from({ length: 9 }, (_, i) => `t${i}`).join(",")).ok,
    ).toBe(false);
  });

  it("accepts a calendar date through tomorrow UTC and rejects a rolled-over day", () => {
    const today = parseOccurredOn("2026-10-14", now);
    const tomorrow = parseOccurredOn("2026-10-15", now);
    expect(today.ok && today.value).toBe("2026-10-14");
    expect(tomorrow.ok && tomorrow.value).toBe("2026-10-15");
    expect(parseOccurredOn("2026-10-16", now).ok).toBe(false);
    expect(parseOccurredOn("2026-02-31", now).ok).toBe(false);
    expect(parseOccurredOn("1899-01-01", now).ok).toBe(false);
  });

  it("names today in the viewer's zone", () => {
    expect(calendarDate("UTC", now)).toBe("2026-10-14");
    expect(calendarDate("America/Los_Angeles", now)).toBe("2026-10-14");
    expect(calendarDate("Pacific/Auckland", now)).toBe("2026-10-15");
    expect(calendarDate("Not/AZone", now)).toBe("2026-10-14");
  });

  it("builds a photo path and refuses a non-http link", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(memoryPhotoPath(circleId, id, "jpg")).toBe(`${circleId}/${id}.jpg`);
    expect(isDisplayableMemoryUrl("https://example.com/a")).toBe(true);
    expect(isDisplayableMemoryUrl("http://127.0.0.1:54321/object/sign")).toBe(
      true,
    );
    expect(isDisplayableMemoryUrl("javascript:alert(1)")).toBe(false);
    expect(isDisplayableMemoryUrl("https://user:pass@example.com/a")).toBe(
      false,
    );
  });

  it("treats a missing photo as a note and drops viewers unless visibility is selected", () => {
    const note = parseMemoryForm({
      body: "  The ferry was late.  ",
      tags: "summer",
      occurredOn: "2026-10-14",
      visibility: "circle",
      viewerIds: [partnerId],
      photo: null,
      now,
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.value).toMatchObject({
      kind: "note",
      body: "The ferry was late.",
      visibility: "circle",
      viewerIds: [],
      tags: ["summer"],
    });

    const selected = parseMemoryForm({
      body: "Only us",
      tags: "",
      occurredOn: "2026-10-14",
      visibility: "selected",
      viewerIds: [partnerId, partnerId, "not-an-id"],
      photo: null,
      now,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.viewerIds).toEqual([partnerId]);
  });

  it("requires a note when there is no photo and caps a caption", () => {
    expect(
      parseMemoryForm({
        body: "   ",
        tags: "",
        occurredOn: "2026-10-14",
        visibility: "circle",
        viewerIds: [],
        photo: null,
        now,
      }).ok,
    ).toBe(false);

    const caption = parseMemoryForm({
      body: "x".repeat(281),
      tags: "",
      occurredOn: "2026-10-14",
      visibility: "circle",
      viewerIds: [],
      photo: new Uint8Array([1]),
      now,
    });
    expect(caption.ok).toBe(false);
  });

  it("maps quota, rate limit, and a missing table", () => {
    expect(memoryWriteFailure("hsummer_storage_quota", "P0001")).toBe(
      MEMORY_QUOTA_MESSAGE,
    );
    expect(memoryWriteFailure("hsummer_rate_limited", "P0001")).toBe(
      MEMORY_RATE_LIMIT_MESSAGE,
    );
    expect(
      memoryWriteFailure("relation memories does not exist", "42P01"),
    ).toContain("week 8");
    expect(formatMemoryUsage(1024 * 1024, MEMORY_QUOTA_BYTES)).toBe(
      "1.0 MB of 100 MB used for photos",
    );
    expect(formatMonth("2026-10")).toBe("October 2026");
  });
});
