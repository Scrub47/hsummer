import { describe, expect, it } from "vitest";

import {
  bestClockEstimate,
  sampleOffset,
  shouldCapture,
  togetherTopic,
} from "@/lib/booth/clock";
import { assignPositions } from "@/lib/booth/positions";

describe("booth positions", () => {
  it("covers every frame once and gives the starter the extra frame", () => {
    expect(assignPositions("4-cut", 2)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(assignPositions("4-cut", 3)).toEqual([[0, 1], [2], [3]]);
    expect(assignPositions("4-cut", 4)).toEqual([[0], [1], [2], [3]]);
    expect(assignPositions("2-cut", 2)).toEqual([[0], [1]]);
    expect(assignPositions("2-cut", 3)).toBeNull();
    expect(assignPositions("4-cut", 1)).toBeNull();
  });
});

describe("clock offset", () => {
  it("uses the middle of the round trip and keeps the fastest sample", () => {
    const slow = sampleOffset({ t0: 1_000, t1: 1_400, serverNow: 5_000 });
    expect(slow).toEqual({ offsetMs: 3800, rttMs: 400 });
    const best = bestClockEstimate([
      { t0: 1_000, t1: 1_400, serverNow: 5_000 },
      { t0: 2_000, t1: 2_080, serverNow: 6_000 },
      { t0: 3_000, t1: 9_000, serverNow: 4_000 },
    ]);
    expect(best).toEqual({ offsetMs: 3960, rttMs: 80 });
    expect(sampleOffset({ t0: 10, t1: 5, serverNow: 8 })).toBeNull();
  });

  it("fires when the estimated server clock reaches captureAt", () => {
    expect(
      shouldCapture({ clientNow: 1_000, offsetMs: 50, captureAtMs: 1_050 }),
    ).toBe(true);
    expect(
      shouldCapture({ clientNow: 1_000, offsetMs: 50, captureAtMs: 1_051 }),
    ).toBe(false);
    expect(togetherTopic("abc")).toBe("together:abc");
  });
});
