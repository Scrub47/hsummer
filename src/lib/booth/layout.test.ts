import { describe, expect, it } from "vitest";

import { STRIP_HEIGHT, STRIP_WIDTH } from "@/lib/booth/fields";
import { coverCrop, frameSlots, type Slot } from "@/lib/booth/layout";
import { BOOTH_THEME_BUNDLES } from "@/lib/booth/themes";

describe("frame slots", () => {
  it("is a 600 by 1800 strip", () => {
    expect(STRIP_WIDTH).toBe(600);
    expect(STRIP_HEIGHT).toBe(1800);
  });

  it("places 4-cut and 2-cut frames inside every theme without overlap", () => {
    expect(BOOTH_THEME_BUNDLES.map((theme) => theme.id)).toEqual([
      "kawaii",
      "minimal",
    ]);

    for (const theme of BOOTH_THEME_BUNDLES) {
      for (const layout of ["4-cut", "2-cut"] as const) {
        const slots = frameSlots(layout, theme);
        expect(slots).toHaveLength(layout === "4-cut" ? 4 : 2);
        slots.forEach((slot, index) => {
          expect(slot.width).toBeGreaterThan(200);
          expect(slot.height).toBeGreaterThan(200);
          expect(slot.x).toBe(theme.padding);
          expect(slot.x + slot.width).toBe(STRIP_WIDTH - theme.padding);
          expect(slot.y).toBeGreaterThanOrEqual(theme.padding + theme.header);
          expect(slot.y + slot.height).toBeLessThanOrEqual(
            STRIP_HEIGHT - theme.padding - theme.footer + theme.gap,
          );
          const previous = slots[index - 1];
          if (previous)
            expect(slot.y).toBeGreaterThanOrEqual(previous.y + previous.height);
        });
        expect(inside(slots, theme.padding)).toBe(true);
      }
    }
  });
});

describe("cover crop", () => {
  it("crops the sides of a wide frame and the top of a tall one", () => {
    expect(coverCrop(1000, 500, 100, 100)).toEqual({
      sx: 250,
      sy: 0,
      sw: 500,
      sh: 500,
    });
    expect(coverCrop(400, 800, 200, 100)).toMatchObject({
      sy: expect.any(Number),
      sh: 200,
    });
    const tall = coverCrop(400, 800, 200, 100);
    expect(tall.sx).toBe(0);
    expect(tall.sy).toBeCloseTo(300);
  });
});

function inside(slots: Slot[], padding: number): boolean {
  return slots.every(
    (slot) =>
      slot.x >= padding &&
      slot.y >= padding &&
      slot.x + slot.width <= STRIP_WIDTH - padding &&
      slot.y + slot.height <= STRIP_HEIGHT - padding,
  );
}
