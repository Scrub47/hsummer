import { describe, expect, it } from "vitest";

import { PING_NOTIFICATION_BODY } from "@/lib/push/payload";

import {
  MOODS,
  MOOD_FORBIDDEN,
  MOOD_PICK_ERROR,
  MOOD_UNAVAILABLE,
  isMoodEmoji,
  moodLabel,
  moodSavedMessage,
  moodWriteFailure,
} from "./fields";

describe("mood palette", () => {
  it("accepts only the six moods and keeps an email out", () => {
    for (const mood of MOODS) {
      expect(isMoodEmoji(mood.emoji)).toBe(true);
      expect(moodLabel(mood.emoji)).toBe(mood.label);
      expect(mood.emoji).not.toContain("@");
      expect(mood.label).not.toContain("@");
    }
    expect(isMoodEmoji("🔥")).toBe(false);
    expect(isMoodEmoji("someone@example.com")).toBe(false);
    expect(moodLabel("🔥")).toBeNull();
  });
});

describe("mood write errors", () => {
  it("names a missing table, a bad emoji, and a refused write", () => {
    expect(moodWriteFailure("relation does not exist", "42P01")).toBe(
      MOOD_UNAVAILABLE,
    );
    expect(moodWriteFailure("missing", "PGRST205")).toBe(MOOD_UNAVAILABLE);
    expect(
      moodWriteFailure(
        'new row violates check "current_moods_emoji_known"',
        undefined,
      ),
    ).toBe(MOOD_PICK_ERROR);
    expect(moodWriteFailure("hsummer_mood_locked", undefined)).toBe(
      MOOD_PICK_ERROR,
    );
    expect(moodWriteFailure("row-level security", "42501")).toBe(
      MOOD_FORBIDDEN,
    );
    expect(moodWriteFailure("something else", "XX000")).toBeNull();
  });
});

describe("mood saved copy", () => {
  it("says that a plain save does not notify", () => {
    const text = moodSavedMessage({
      partnerName: "Summer",
      waiting: false,
      shared: false,
      push: null,
    });
    expect(text).toContain("Summer");
    expect(text).toContain("No notification was sent.");
    expect(text).not.toContain(MOODS[0]?.emoji);
  });

  it("keeps the lock-screen sentence off the in-app share line's emoji", () => {
    const text = moodSavedMessage({
      partnerName: "Summer",
      waiting: false,
      shared: true,
      push: "unconfigured",
    });
    expect(text).toContain("shared with Summer");
    expect(text).toContain("aren't configured");
    expect(text).not.toContain(PING_NOTIFICATION_BODY);
    for (const mood of MOODS) {
      expect(text).not.toContain(mood.emoji);
    }
  });

  it("uses the same device outcomes as Thinking of You", () => {
    expect(
      moodSavedMessage({
        partnerName: "Summer",
        waiting: false,
        shared: true,
        push: "none",
      }),
    ).toContain("turn notifications on");
    expect(
      moodSavedMessage({
        partnerName: "Summer",
        waiting: false,
        shared: true,
        push: "sent",
      }),
    ).toBe("Saved, and sent to Summer.");
    expect(
      moodSavedMessage({
        partnerName: null,
        waiting: true,
        shared: false,
        push: null,
      }),
    ).toContain("when they join");
    expect(
      moodSavedMessage({
        partnerName: null,
        waiting: false,
        shared: false,
        push: null,
      }),
    ).toContain("The circle can see it here");
  });
});
