import { describe, expect, it } from "vitest";

import {
  GROUP_PUSH_WINDOW_MS,
  MUTE_UNTIL_OFF,
  decideGroupPush,
  isMuted,
  muteStatus,
  muteUntilFromChoice,
} from "@/lib/push/batch";

const now = Date.parse("2027-03-01T18:00:00.000Z");

describe("group push batching", () => {
  it("sends the first one, holds the rest of the minute, then sends one digest", () => {
    const first = decideGroupPush({
      mutedUntil: null,
      nowMs: now,
      lastSentAtMs: null,
      heldCount: 0,
    });
    expect(first).toEqual({ decision: "send", nextHeld: 0, stampSent: true });

    const held = decideGroupPush({
      mutedUntil: null,
      nowMs: now + 10_000,
      lastSentAtMs: now,
      heldCount: 0,
    });
    expect(held).toEqual({ decision: "hold", nextHeld: 1, stampSent: false });

    const again = decideGroupPush({
      mutedUntil: null,
      nowMs: now + 20_000,
      lastSentAtMs: now,
      heldCount: held.nextHeld,
    });
    expect(again.decision).toBe("hold");
    expect(again.nextHeld).toBe(2);

    const later = decideGroupPush({
      mutedUntil: null,
      nowMs: now + GROUP_PUSH_WINDOW_MS,
      lastSentAtMs: now,
      heldCount: again.nextHeld,
    });
    expect(later).toEqual({ decision: "digest", nextHeld: 0, stampSent: true });
  });

  it("stays quiet while the circle is muted", () => {
    expect(isMuted(new Date(now + 60_000).toISOString(), now)).toBe(true);
    expect(isMuted(new Date(now - 1).toISOString(), now)).toBe(false);
    expect(isMuted(null, now)).toBe(false);
    const muted = decideGroupPush({
      mutedUntil: MUTE_UNTIL_OFF,
      nowMs: now,
      lastSentAtMs: null,
      heldCount: 3,
    });
    expect(muted.decision).toBe("muted");
    expect(muted.nextHeld).toBe(3);
    expect(muteStatus(MUTE_UNTIL_OFF, now)).toMatch(/turn them back on/);
    expect(muteUntilFromChoice("hour", new Date(now))).toBe(
      new Date(now + 60 * 60 * 1000).toISOString(),
    );
    expect(muteUntilFromChoice("off", new Date(now))).toBeNull();
    expect(muteUntilFromChoice("nope", new Date(now))).toBeUndefined();
  });
});
