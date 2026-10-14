import { describe, expect, it } from "vitest";

import {
  BOOTH_CAPTION_ERROR,
  BOOTH_JPEG_ERROR,
  BOOTH_LAYOUT_ERROR,
  BOOTH_SHOTS_ERROR,
  BOOTH_THEME_ERROR,
  boothWriteFailure,
  isBoothShotPath,
  parseBoothForm,
  shotCount,
} from "@/lib/booth/fields";

const circleId = "11111111-1111-4111-8111-111111111111";

function failure(overrides: Record<string, unknown>): string | undefined {
  const parsed = parseBoothForm({
    circleId,
    theme: "kawaii",
    layout: "4-cut",
    filter: "none",
    caption: "",
    shotCount: 4,
    ...overrides,
  });
  return parsed.ok ? undefined : parsed.error;
}

describe("parseBoothForm", () => {
  it("accepts a kawaii 4-cut with an optional caption", () => {
    const parsed = parseBoothForm({
      circleId,
      theme: "kawaii",
      layout: "4-cut",
      filter: "warm",
      caption: "  The ferry  ",
      shotCount: 4,
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        circleId,
        theme: "kawaii",
        layout: "4-cut",
        filter: "warm",
        caption: "The ferry",
      },
    });
  });

  it("accepts minimal and a 2-cut, and drops an empty caption", () => {
    const parsed = parseBoothForm({
      circleId,
      theme: "minimal",
      layout: "2-cut",
      filter: "none",
      caption: "   ",
      shotCount: shotCount("2-cut"),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.caption).toBeNull();
    expect(parsed.value.theme).toBe("minimal");
  });

  it("rejects the wrong number of shots, a later theme, and a long caption", () => {
    expect(failure({ shotCount: 2 })).toBe(BOOTH_SHOTS_ERROR);
    expect(failure({ theme: "retro-film" })).toBe(BOOTH_THEME_ERROR);
    expect(failure({ layout: "wide" })).toBe(BOOTH_LAYOUT_ERROR);
    expect(failure({ caption: "a".repeat(281) })).toBe(BOOTH_CAPTION_ERROR);
  });
});

describe("booth paths and errors", () => {
  it("accepts a frame path and refuses a memory photo path", () => {
    expect(isBoothShotPath(`${circleId}/${circleId}/0.jpg`)).toBe(true);
    expect(isBoothShotPath(`${circleId}/${circleId}.jpg`)).toBe(false);
    expect(isBoothShotPath(`${circleId}/${circleId}/4.jpg`)).toBe(false);
  });

  it("maps database failures onto the sentences the page shows", () => {
    expect(boothWriteFailure("hsummer_rate_limited", "P0001")).toMatch(/Wait/);
    expect(boothWriteFailure("hsummer_storage_quota", "P0001")).toMatch(
      /photo space/,
    );
    expect(
      boothWriteFailure("save_solo_booth does not exist", "PGRST202"),
    ).toMatch(/week 13/);
    expect(boothWriteFailure("hsummer_booth_memory", "P0001")).toBe(
      "That strip isn't valid.",
    );
    expect(BOOTH_JPEG_ERROR).toMatch(/JPEG/);
  });
});
