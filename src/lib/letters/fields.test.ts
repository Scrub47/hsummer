import { describe, expect, it } from "vitest";

import {
  DEFAULT_LETTER_CATEGORIES,
  LETTER_BODY_MAX,
  categoryLabel,
  dearHeading,
  parseCategoryLabel,
  parseLetterDraft,
} from "@/lib/letters/fields";

const custom = ["Rainy days"];

describe("parseLetterDraft", () => {
  it("accepts a default category and trims the letter", () => {
    const parsed = parseLetterDraft({
      category: "need-motivation",
      title: "  For the ferry  ",
      body: "  The ferry is still ours.\nCome anyway.  ",
      design: "kawaii",
      customLabels: custom,
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        category: "need-motivation",
        title: "For the ferry",
        body: "The ferry is still ours.\nCome anyway.",
        design: "kawaii",
      },
    });
  });

  it("accepts a custom label and an empty title", () => {
    const parsed = parseLetterDraft({
      category: "Rainy days",
      title: "   ",
      body: "Bring the grey sweater.",
      design: "minimal",
      customLabels: custom,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBeNull();
    expect(parsed.value.category).toBe("Rainy days");
  });

  it("rejects a category that is not on the list", () => {
    const parsed = parseLetterDraft({
      category: "surprise",
      title: "",
      body: "Hello",
      design: "minimal",
      customLabels: custom,
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a letter past the character cap and a title with @", () => {
    expect(
      parseLetterDraft({
        category: "feeling-sad",
        title: "",
        body: "a".repeat(LETTER_BODY_MAX + 1),
        design: "retro-film",
        customLabels: [],
      }).ok,
    ).toBe(false);

    expect(
      parseLetterDraft({
        category: "feeling-sad",
        title: "me@example.com",
        body: "Hello",
        design: "minimal",
        customLabels: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects a design that is not one of the three", () => {
    expect(
      parseLetterDraft({
        category: "need-help",
        title: "",
        body: "Hello",
        design: "neon",
        customLabels: [],
      }).ok,
    ).toBe(false);
  });
});

describe("parseCategoryLabel", () => {
  it("collapses spaces and rejects a built-in name", () => {
    expect(parseCategoryLabel("  Rainy   days ").ok && "yes").toBe("yes");
    const rainy = parseCategoryLabel("  Rainy   days ");
    expect(rainy.ok && rainy.value).toBe("Rainy days");

    expect(parseCategoryLabel("Need motivation").ok).toBe(false);
    expect(parseCategoryLabel("need-motivation").ok).toBe(false);
    expect(parseCategoryLabel("a@b").ok).toBe(false);
    expect(parseCategoryLabel("")).toMatchObject({ ok: false });
  });
});

describe("dear heading and category labels", () => {
  it("opens with the recipient's name", () => {
    expect(dearHeading("Summer")).toBe("Dear Summer");
    expect(dearHeading("  ")).toBe("Dear Former member");
    expect(dearHeading(null)).toBe("Dear Former member");
  });

  it("names every default slug and leaves a custom label as written", () => {
    for (const category of DEFAULT_LETTER_CATEGORIES) {
      expect(categoryLabel(category.slug)).toBe(category.label);
    }
    expect(categoryLabel("Rainy days", ["Rainy days"])).toBe("Rainy days");
  });
});
