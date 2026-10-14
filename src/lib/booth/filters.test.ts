import { describe, expect, it } from "vitest";

import { applyFilter } from "@/lib/booth/filters";

describe("booth filters", () => {
  it("turns a pixel gray, warm, and cool without touching alpha", () => {
    const gray = pixels(20, 40, 80, 255);
    applyFilter(gray, "bw");
    expect(gray[0]).toBe(gray[1]);
    expect(gray[1]).toBe(gray[2]);
    expect(gray[3]).toBe(255);

    const warm = pixels(100, 100, 100, 200);
    applyFilter(warm, "warm");
    expect(warm[0]).toBeGreaterThan(100);
    expect(warm[2]).toBeLessThan(100);
    expect(warm[3]).toBe(200);

    const cool = pixels(100, 100, 100, 255);
    applyFilter(cool, "cool");
    expect(cool[2]).toBeGreaterThan(100);
    expect(cool[0]).toBeLessThan(100);
  });

  it("keeps grain stable for the same pixels", () => {
    const first = pixels(80, 90, 100, 255);
    const second = pixels(80, 90, 100, 255);
    applyFilter(first, "grain");
    applyFilter(second, "grain");
    expect([...first]).toEqual([...second]);
    expect(first[0]).not.toBe(80);
  });

  it("leaves a pixel alone when the filter is none", () => {
    const original = pixels(1, 2, 3, 4);
    applyFilter(original, "none");
    expect([...original]).toEqual([1, 2, 3, 4]);
  });
});

function pixels(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): Uint8ClampedArray {
  return new Uint8ClampedArray([red, green, blue, alpha]);
}
