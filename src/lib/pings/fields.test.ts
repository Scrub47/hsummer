import { describe, expect, it } from "vitest";

import {
  BROADCAST_PINGS_ENABLED,
  PING_BROADCAST_ERROR,
  PING_LIMIT,
  PING_RATE_LIMIT_MESSAGE,
  PING_RETENTION_DAYS,
  thinkingOfYouCutoff,
  thinkingOfYouStillVisible,
  visiblePingsOr,
  circlePingInsert,
  missingName,
  parsePingRequest,
  parseRecipientField,
  partnerReasonMessage,
  pingPhrase,
  pingSendAllowed,
  pingWriteFailure,
  resolveCircleRecipient,
  resolveCouplePartner,
} from "@/lib/pings/fields";

const circleId = "11111111-1111-4111-8111-111111111111";

describe("Thinking of You retention", () => {
  it("keeps one three-day window for the query and the cleanup", () => {
    expect(PING_RETENTION_DAYS).toBe(3);
    const now = Date.parse("2026-10-19T19:00:00.000Z");
    const cutoff = thinkingOfYouCutoff(now);
    expect(cutoff).toBe("2026-10-16T19:00:00.000Z");
    expect(visiblePingsOr(cutoff)).toBe(
      'ping_type.neq.thinking-of-you,sent_at.gte."2026-10-16T19:00:00.000Z"',
    );
    expect(visiblePingsOr(`${cutoff}",id.eq.1`)).toBe(
      "ping_type.neq.thinking-of-you",
    );
    expect(visiblePingsOr("not-a-date")).toBe("ping_type.neq.thinking-of-you");
    expect(thinkingOfYouStillVisible("thinking-of-you", cutoff, now)).toBe(
      true,
    );
    expect(
      thinkingOfYouStillVisible(
        "thinking-of-you",
        "2026-10-16T18:59:59.000Z",
        now,
      ),
    ).toBe(false);
    expect(
      thinkingOfYouStillVisible("mood-share", "2020-01-01T00:00:00.000Z", now),
    ).toBe(true);
    expect(
      thinkingOfYouStillVisible("thinking-of-you", "not-a-date", now),
    ).toBe(true);
  });
});

describe("Thinking of You requests", () => {
  it("accepts one person or everyone, and still refuses a mood on this route", () => {
    expect(BROADCAST_PINGS_ENABLED).toBe(true);
    const person = "22222222-2222-4222-8222-222222222222";
    expect(parsePingRequest({ circleId, toUserId: null })).toEqual({
      ok: true,
      circleId,
      secretVariant: false,
      recipient: { kind: "broadcast" },
    });
    expect(parsePingRequest({ circleId, toUserId: person })).toEqual({
      ok: true,
      circleId,
      secretVariant: false,
      recipient: { kind: "member", userId: person },
    });
    expect(
      parsePingRequest({ circleId, toUserId: null, secretVariant: true }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      parsePingRequest({ circleId, pingType: "mood-share" }),
    ).toMatchObject({
      ok: false,
    });
    expect(parsePingRequest({ circleId, moodEmoji: "😊" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(PING_BROADCAST_ERROR).toMatch(/partner/i);
  });

  it("accepts a circle id and an optional secret flag", () => {
    expect(parsePingRequest({ circleId })).toEqual({
      ok: true,
      circleId,
      secretVariant: false,
      recipient: { kind: "auto" },
    });
    expect(parsePingRequest({ circleId, secretVariant: true })).toEqual({
      ok: true,
      circleId,
      secretVariant: true,
      recipient: { kind: "auto" },
    });
    expect(parsePingRequest({ circleId, secretVariant: "yes" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(parsePingRequest(null)).toMatchObject({ ok: false });
    expect(parsePingRequest({ circleId: "not-a-uuid" })).toMatchObject({
      ok: false,
    });
  });
});

describe("couple partner", () => {
  it("picks the only other member of an active couple", () => {
    expect(
      resolveCouplePartner({
        selfId: "me",
        circleType: "couple",
        status: "active",
        activeMemberIds: ["me", "summer"],
      }),
    ).toEqual({ ok: true, partnerId: "summer" });
  });

  it("does not guess when the circle is pending, a group, or not a pair", () => {
    expect(
      resolveCouplePartner({
        selfId: "me",
        circleType: "couple",
        status: "pending",
        activeMemberIds: ["me"],
      }).ok,
    ).toBe(false);
    expect(
      resolveCouplePartner({
        selfId: "me",
        circleType: "group",
        status: "active",
        activeMemberIds: ["me", "a", "b"],
      }),
    ).toEqual({ ok: false, reason: "not_couple" });
    expect(
      resolveCouplePartner({
        selfId: "me",
        circleType: "couple",
        status: "active",
        activeMemberIds: ["me", "a", "b"],
      }),
    ).toEqual({ ok: false, reason: "ambiguous" });
    expect(partnerReasonMessage("not_couple").status).toBe(400);
    expect(partnerReasonMessage("pending").status).toBe(409);
  });
});

describe("circle recipient", () => {
  const me = "11111111-1111-4111-8111-111111111111";
  const summer = "22222222-2222-4222-8222-222222222222";
  const third = "33333333-3333-4333-8333-333333333333";

  it("keeps a couple and a pair on the other person", () => {
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "couple",
        status: "active",
        activeMemberIds: [me, summer],
        request: { kind: "auto" },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: true, toUserId: summer, mode: "partner" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "group",
        status: "active",
        activeMemberIds: [me, summer],
        request: { kind: "auto" },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: true, toUserId: summer, mode: "partner" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "couple",
        status: "active",
        activeMemberIds: [me, summer],
        request: { kind: "member", userId: summer },
        allowBroadcast: false,
      }),
    ).toEqual({ ok: false, reason: "couple_picker" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "couple",
        status: "active",
        activeMemberIds: [me, summer],
        request: { kind: "broadcast" },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: false, reason: "broadcast_refused" });
  });

  it("lets a larger circle pick one person or everyone, never a letter to everyone", () => {
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "friends",
        status: "active",
        activeMemberIds: [me, summer, third],
        request: { kind: "member", userId: third },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: true, toUserId: third, mode: "chosen" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "family",
        status: "active",
        activeMemberIds: [me, summer, third],
        request: { kind: "broadcast" },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: true, toUserId: null, mode: "broadcast" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "group",
        status: "active",
        activeMemberIds: [me, summer, third],
        request: { kind: "broadcast" },
        allowBroadcast: false,
      }),
    ).toEqual({ ok: false, reason: "broadcast_refused" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "group",
        status: "active",
        activeMemberIds: [me, summer, third],
        request: { kind: "auto" },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: false, reason: "needs_choice" });
    expect(
      resolveCircleRecipient({
        selfId: me,
        circleType: "group",
        status: "active",
        activeMemberIds: [me, summer, third],
        request: { kind: "member", userId: me },
        allowBroadcast: true,
      }),
    ).toEqual({ ok: false, reason: "not_member" });
    expect(parseRecipientField(null)).toEqual({ kind: "auto" });
    expect(parseRecipientField("everyone")).toEqual({ kind: "broadcast" });
    expect(parseRecipientField(third)).toEqual({
      kind: "member",
      userId: third,
    });
    expect(parseRecipientField("nope")).toBeNull();
  });
});

describe("rate limit and copy", () => {
  it("allows fewer than the cap and refuses the next one", () => {
    expect(pingSendAllowed(PING_LIMIT - 1)).toBe(true);
    expect(pingSendAllowed(PING_LIMIT)).toBe(false);
    expect(pingSendAllowed(-1)).toBe(false);
    expect(pingWriteFailure("hsummer_rate_limited")).toEqual({
      status: 429,
      error: PING_RATE_LIMIT_MESSAGE,
    });
  });

  it("personalizes Missing<name> in the app and not as a push string", () => {
    expect(missingName("Summer")).toBe("Missing Summer");
    expect(pingPhrase(true, "Summer")).toBe("Missing Summer");
    expect(pingPhrase(false, "Summer")).toBe("Thinking of you");
    expect(missingName("  ")).toBe("Missing them");
    expect(pingPhrase(true, "Summer")).not.toContain("@");
  });
});

describe("shared mood ping row", () => {
  const fromUserId = "22222222-2222-4222-8222-222222222222";
  const toUserId = "33333333-3333-4333-8333-333333333333";

  it("builds a mood-share row and leaves Thinking of You unchanged", () => {
    expect(
      circlePingInsert({
        circleId,
        fromUserId,
        toUserId,
        secretVariant: false,
        moodEmoji: "😌",
      }),
    ).toEqual({
      ok: true,
      row: {
        circle_id: circleId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        ping_type: "mood-share",
        mood_emoji: "😌",
        secret_variant: false,
      },
    });
    expect(
      circlePingInsert({
        circleId,
        fromUserId,
        toUserId,
        secretVariant: true,
        moodEmoji: null,
      }).ok &&
        circlePingInsert({
          circleId,
          fromUserId,
          toUserId,
          secretVariant: true,
          moodEmoji: null,
        }),
    ).toMatchObject({
      ok: true,
      row: {
        ping_type: "thinking-of-you",
        mood_emoji: null,
        secret_variant: true,
      },
    });
  });

  it("refuses an unknown emoji and refuses mixing a mood with Missing", () => {
    expect(
      circlePingInsert({
        circleId,
        fromUserId,
        toUserId,
        secretVariant: false,
        moodEmoji: "not-a-mood",
      }).ok,
    ).toBe(false);
    expect(
      circlePingInsert({
        circleId,
        fromUserId,
        toUserId,
        secretVariant: true,
        moodEmoji: "😊",
      }).ok,
    ).toBe(false);
  });
});
