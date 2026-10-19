import { describe, expect, it } from "vitest";

import { PING_RETENTION_DAYS } from "@/lib/pings/fields";
import { loadRecentPings } from "@/lib/pings/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function formatIn(iso: string, timeZone: string, withZone = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(withZone ? { timeZoneName: "short" as const } : {}),
  }).format(new Date(iso));
}

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";
const names = new Map([
  [selfId, "Isaac"],
  [partnerId, "Summer"],
]);

function ping(overrides: Record<string, unknown>) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    from_user_id: selfId,
    to_user_id: partnerId,
    ping_type: "thinking-of-you",
    mood_emoji: null,
    secret_variant: false,
    sent_at: sentAt,
    ...overrides,
  };
}

describe("loadRecentPings", () => {
  it("names the sender, formats the time in the viewer's zone, and hides nothing RLS already returned", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        pings: queryResult([
          ping({}),
          ping({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            secret_variant: true,
          }),
          ping({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            from_user_id: null,
            ping_type: "mood-share",
            mood_emoji: "🌤️",
          }),
        ]),
      },
    });

    const rows = await loadRecentPings(
      session,
      circleId,
      names,
      "America/Los_Angeles",
    );
    expect(rows.map((row) => row.fromName)).toEqual([
      "Isaac",
      "Isaac",
      "Former member",
    ]);
    expect(rows.map((row) => row.phrase)).toEqual([
      "Thinking of you",
      "Missing Summer",
      "Feeling 🌤️",
    ]);
    expect(rows[0]?.when).toBe(formatIn(sentAt, "America/Los_Angeles"));
  });

  it("drops a Thinking of You older than three days and keeps an old mood share", async () => {
    const stale = new Date(
      Date.now() - (PING_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const session = fakeSession({
      userId: selfId,
      tables: {
        pings: queryResult([
          ping({ sent_at: stale }),
          ping({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            sent_at: stale,
            ping_type: "mood-share",
            mood_emoji: "😌",
          }),
        ]),
      },
    });
    const rows = await loadRecentPings(session, circleId, names, "UTC");
    expect(rows.map((row) => row.phrase)).toEqual(["Feeling 😌"]);
  });

  it("falls back to UTC when the timezone is not real", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: { pings: queryResult([ping({ sent_at: "not-a-date" })]) },
    });
    const blank = await loadRecentPings(session, circleId, names, "UTC");
    expect(blank[0]?.when).toBe("");

    const session2 = fakeSession({
      userId: selfId,
      tables: { pings: queryResult([ping({})]) },
    });
    const fallback = await loadRecentPings(
      session2,
      circleId,
      names,
      "Not/AZone",
    );
    expect(fallback[0]?.when).toBe(formatIn(sentAt, "UTC", true));
  });

  it("returns an empty list when the read fails", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        pings: queryResult(null, { message: "nope", code: "42501" }),
      },
    });
    expect(await loadRecentPings(session, circleId, names, "UTC")).toEqual([]);
  });

  it("says Former member when the sender has no profile in this circle", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        pings: queryResult([
          ping({ from_user_id: "99999999-9999-4999-8999-999999999999" }),
        ]),
      },
    });
    const rows = await loadRecentPings(session, circleId, names, "UTC");
    expect(rows[0]?.fromName).toBe("Former member");
    expect(rows[0]?.phrase).toBe("Thinking of you");
  });
});
