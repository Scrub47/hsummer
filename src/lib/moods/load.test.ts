import { describe, expect, it } from "vitest";

import { loadCurrentMoods } from "@/lib/moods/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";

function mood(overrides: Record<string, unknown> = {}) {
  return {
    user_id: partnerId,
    emoji: "😌",
    updated_at: "2026-11-23T20:00:00.000Z",
    ...overrides,
  };
}

describe("loadCurrentMoods", () => {
  it("keeps known moods and drops one the palette does not have", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        current_moods: queryResult([
          mood(),
          mood({
            user_id: selfId,
            emoji: "😊",
            updated_at: "2026-11-23T21:00:00.000Z",
          }),
          mood({
            user_id: "99999999-9999-4999-8999-999999999999",
            emoji: "🔥",
          }),
        ]),
      },
    });

    const loaded = await loadCurrentMoods(
      session,
      circleId,
      "America/Los_Angeles",
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.moods.map((row) => row.label)).toEqual(["Good", "Calm"]);
    expect(loaded.moods[0]?.when).toBe("Nov 23, 1:00 PM");
    expect(loaded.moods.map((row) => row.emoji)).not.toContain("🔥");
  });

  it("returns not-ok when the table is missing", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        current_moods: queryResult(null, { message: "missing", code: "42P01" }),
      },
    });
    const loaded = await loadCurrentMoods(session, circleId, "UTC");
    expect(loaded).toEqual({ ok: false, moods: [] });
  });

  it("leaves the time blank when the timestamp is not a date", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        current_moods: queryResult([mood({ updated_at: "not-a-date" })]),
      },
    });
    const loaded = await loadCurrentMoods(session, circleId, "UTC");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.moods[0]?.when).toBe("");
  });
});
