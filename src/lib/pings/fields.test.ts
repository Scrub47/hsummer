import { describe, expect, it } from "vitest";

import {
  BROADCAST_PINGS_ENABLED,
  PING_BROADCAST_ERROR,
  PING_LIMIT,
  PING_RATE_LIMIT_MESSAGE,
  missingName,
  parsePingRequest,
  partnerReasonMessage,
  pingPhrase,
  pingSendAllowed,
  pingWriteFailure,
  resolveCouplePartner,
} from "@/lib/pings/fields";

const circleId = "11111111-1111-4111-8111-111111111111";

describe("Thinking of You requests", () => {
  it("keeps whole-circle pings flagged off and refuses a recipient in the body", () => {
    expect(BROADCAST_PINGS_ENABLED).toBe(false);
    expect(parsePingRequest({ circleId, toUserId: null })).toEqual({
      ok: false,
      status: 400,
      error: PING_BROADCAST_ERROR,
    });
    expect(
      parsePingRequest({
        circleId,
        toUserId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      parsePingRequest({ circleId, pingType: "mood-share" }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("accepts a circle id and an optional secret flag", () => {
    expect(parsePingRequest({ circleId })).toEqual({
      ok: true,
      circleId,
      secretVariant: false,
    });
    expect(parsePingRequest({ circleId, secretVariant: true })).toEqual({
      ok: true,
      circleId,
      secretVariant: true,
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
