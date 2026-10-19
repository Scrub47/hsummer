import { describe, expect, it } from "vitest";

import { vibrate } from "@/lib/feel/feedback";

describe("haptics", () => {
  it("does nothing when the browser has no vibrate function", () => {
    expect(vibrate(12)).toBe(false);
  });

  it("calls navigator.vibrate when it exists and does not invent a fallback", () => {
    const calls: Array<number | number[]> = [];
    const nav = navigator as unknown as {
      vibrate?: (pattern: number | number[]) => boolean;
    };
    nav.vibrate = (pattern) => {
      calls.push(pattern);
      return true;
    };
    expect(vibrate([12, 40, 18])).toBe(true);
    expect(calls).toEqual([[12, 40, 18]]);
    delete nav.vibrate;
  });
});
