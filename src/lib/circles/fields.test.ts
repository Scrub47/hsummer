import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GROUP_CIRCLE_TYPES_ENABLED,
  INVITE_RATE_LIMIT_MESSAGE,
  JOIN_IP_LIMIT,
  JOIN_USER_LIMIT,
  circleRpcFailure,
  circleTitle,
  circleNeedsPicker,
  circleTypeOffered,
  hashInviteToken,
  hashIp,
  inviteStateMessage,
  isInviteToken,
  joinAttemptAllowed,
  maxUsesForType,
  parseCircleName,
  parseCircleType,
  requestIp,
} from "@/lib/circles/fields";

describe("circle types", () => {
  it("offers a couple, a group, a family, and friends", () => {
    expect(GROUP_CIRCLE_TYPES_ENABLED).toBe(true);
    expect(circleTypeOffered("couple")).toBe(true);
    expect(circleTypeOffered("group")).toBe(true);
    expect(circleTypeOffered("family")).toBe(true);
    expect(circleTypeOffered("friends")).toBe(true);
    expect(parseCircleType("couple")).toEqual({ ok: true, value: "couple" });
    expect(parseCircleType("group")).toEqual({ ok: true, value: "group" });
    expect(parseCircleType("nope").ok).toBe(false);
    expect(circleNeedsPicker(1)).toBe(false);
    expect(circleNeedsPicker(2)).toBe(true);
  });

  it("gives a couple one use and leaves other types open", () => {
    expect(maxUsesForType("couple")).toBe(1);
    expect(maxUsesForType("group")).toBeNull();
    expect(maxUsesForType("family")).toBeNull();
    expect(maxUsesForType("friends")).toBeNull();
  });
});

describe("circle names", () => {
  it("treats a blank name as unnamed and rejects an email", () => {
    expect(parseCircleName("  ")).toEqual({ ok: true, value: null });
    expect(parseCircleName(null)).toEqual({ ok: true, value: null });
    expect(parseCircleName("Me & Summer")).toEqual({
      ok: true,
      value: "Me & Summer",
    });
    expect(parseCircleName("summer@example.com").ok).toBe(false);
    expect(parseCircleName("x".repeat(81)).ok).toBe(false);
  });
});

describe("invite tokens", () => {
  it("accepts 32 bytes of hex and hashes them like SHA-256", () => {
    const token = "ab".repeat(32);
    expect(isInviteToken(token)).toBe(true);
    expect(isInviteToken("not-a-token")).toBe(false);
    expect(isInviteToken(`${token}ff`)).toBe(false);
    expect(hashInviteToken("abc")).toBe(
      createHash("sha256").update("abc", "utf8").digest("hex"),
    );
  });
});

describe("join rate limit", () => {
  it("allows the limit and refuses the next hit", () => {
    expect(joinAttemptAllowed({ userHits: JOIN_USER_LIMIT, ipHits: 1 })).toBe(
      true,
    );
    expect(
      joinAttemptAllowed({ userHits: JOIN_USER_LIMIT + 1, ipHits: 1 }),
    ).toBe(false);
    expect(joinAttemptAllowed({ userHits: 1, ipHits: JOIN_IP_LIMIT })).toBe(
      true,
    );
    expect(joinAttemptAllowed({ userHits: 1, ipHits: JOIN_IP_LIMIT + 1 })).toBe(
      false,
    );
  });

  it("reads the client IP from the first forwarded hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
      "x-real-ip": "198.51.100.8",
    });
    expect(requestIp(headers)).toBe("203.0.113.5");
    expect(hashIp("203.0.113.5")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("203.0.113.5")).not.toContain("203.0.113.5");
    expect(requestIp(new Headers())).toBe("unknown");
  });
});

describe("invite copy", () => {
  it("names a circle and explains a dead link", () => {
    expect(circleTitle("Me & Summer", "couple")).toBe("Me & Summer");
    expect(circleTitle(null, "couple")).toBe("Your circle");
    expect(circleTitle("  ", "family")).toBe("Your family");
    expect(inviteStateMessage("full")).toMatch(/full/i);
    expect(inviteStateMessage("rate_limited")).toMatch(/wait/i);
    expect(circleRpcFailure("hsummer_rate_limited")).toBe(
      INVITE_RATE_LIMIT_MESSAGE,
    );
    expect(circleRpcFailure("hsummer_couple_closed")).toMatch(/new circle/i);
    expect(circleRpcFailure("hsummer_demo_readonly")).toMatch(/demo/i);
    expect(inviteStateMessage("demo")).toMatch(/demo/i);
    expect(INVITE_RATE_LIMIT_MESSAGE).toMatch(/wait/i);
    expect(inviteStateMessage("joined")).toBeNull();
    expect(inviteStateMessage("ready")).toBeNull();
  });
});
