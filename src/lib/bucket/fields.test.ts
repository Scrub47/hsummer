import { describe, expect, it } from "vitest";

import {
  BUCKET_UNAVAILABLE,
  authorLabel,
  bucketWriteFailure,
  formatPlannedDate,
  parseBucketForm,
  parseBucketLink,
  parsePlannedDate,
} from "@/lib/bucket/fields";

describe("bucket list fields", () => {
  it("accepts a full item and turns blanks into nulls", () => {
    const form = new FormData();
    form.set("title", "  Night market  ");
    form.set("category", "restaurant");
    form.set("status", "planned");
    form.set("plannedDate", "2026-12-01");
    form.set("notes", "  mango rice  ");
    form.set("link", " https://example.com/menu ");

    expect(parseBucketForm(form, { statusDefaultsToIdea: true })).toEqual({
      ok: true,
      value: {
        title: "Night market",
        category: "restaurant",
        status: "planned",
        plannedDate: "2026-12-01",
        notes: "mango rice",
        link: "https://example.com/menu",
      },
    });

    form.set("notes", "   ");
    form.set("link", "");
    form.set("plannedDate", "");
    form.delete("status");
    expect(parseBucketForm(form, { statusDefaultsToIdea: true })).toMatchObject(
      {
        ok: true,
        value: {
          status: "idea",
          notes: null,
          link: null,
          plannedDate: null,
        },
      },
    );
  });

  it("rejects a bad date, a script link, and an unknown category", () => {
    expect(parsePlannedDate("2026-02-31")).toMatchObject({ ok: false });
    expect(parsePlannedDate("12/01/2026")).toMatchObject({ ok: false });
    expect(parseBucketLink("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(parseBucketLink("https://user:secret@example.com/a")).toMatchObject({
      ok: false,
    });
    expect(parseBucketLink("https://example.com/a b")).toMatchObject({
      ok: false,
    });

    const form = new FormData();
    form.set("title", "Movie");
    form.set("category", "concert");
    expect(parseBucketForm(form, { statusDefaultsToIdea: true })).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it("keeps a calendar date on that calendar day", () => {
    expect(formatPlannedDate("2026-12-01")).toBe("Dec 1, 2026");
  });

  it("names the author, or Former member when the account is gone", () => {
    const names = new Map([["summer", "Summer"]]);
    expect(authorLabel("summer", "isaac", names)).toBe("Summer");
    expect(authorLabel("isaac", "isaac", names)).toBe("you");
    expect(authorLabel(null, "isaac", names)).toBe("Former member");
    expect(authorLabel("left", "isaac", names)).toBe("Former member");
  });

  it("maps a missing table and a locked row onto sentences", () => {
    expect(
      bucketWriteFailure("relation bucket_items does not exist", "42P01"),
    ).toBe(BUCKET_UNAVAILABLE);
    expect(bucketWriteFailure("hsummer_bucket_locked", "P0001")).toBe(
      "That item isn't valid.",
    );
    expect(
      bucketWriteFailure("new row violates row-level security", "42501"),
    ).toBe("You can't change that item.");
    expect(bucketWriteFailure("something else", "XX000")).toBeNull();
  });
});
