import { describe, expect, it } from "vitest";

import { loadCircle, loadCircles } from "@/lib/circles/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";
const fileId = "44444444-4444-4444-8444-444444444444";

describe("loadCircles", () => {
  it("returns an empty list when the person has no memberships", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: { circle_members: queryResult([]) },
    });
    expect(await loadCircles(session)).toEqual({ ok: true, circles: [] });
  });

  it("drops a row whose type or status is not one the app knows", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        circle_members: queryResult([{ circle_id: circleId }]),
        circles: queryResult([
          {
            id: circleId,
            name: "Me & Summer",
            circle_type: "couple",
            status: "pending",
            created_at: "2026-11-16T00:00:00.000Z",
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Weird",
            circle_type: "secret",
            status: "active",
            created_at: "2026-11-16T00:00:00.000Z",
          },
        ]),
      },
    });
    const loaded = await loadCircles(session);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.circles).toEqual([
      {
        id: circleId,
        title: "Me & Summer",
        name: "Me & Summer",
        circleType: "couple",
        status: "pending",
        createdAt: "2026-11-16T00:00:00.000Z",
      },
    ]);
  });

  it("fails closed when the membership read errors", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        circle_members: queryResult(null, { message: "missing" }),
      },
    });
    expect(await loadCircles(session)).toEqual({ ok: false, circles: [] });
  });
});

describe("loadCircle", () => {
  it("uses a legacy https photo as-is and signs an object in that person's folder", async () => {
    let signed = 0;
    const session = fakeSession({
      userId: selfId,
      onSignedUrl: () => {
        signed += 1;
      },
      signedUrl: {
        signedUrl: "https://example.com/signed.png",
        error: null,
      },
      tables: {
        circles: queryResult({
          id: circleId,
          name: null,
          circle_type: "couple",
          status: "active",
          created_at: "2026-11-16T00:00:00.000Z",
        }),
        circle_members: queryResult([
          {
            user_id: selfId,
            joined_at: "2026-11-16T00:00:00.000Z",
            left_at: null,
          },
          {
            user_id: partnerId,
            joined_at: "2026-11-16T01:00:00.000Z",
            left_at: null,
          },
        ]),
        profiles: queryResult([
          {
            id: selfId,
            display_name: "Isaac",
            avatar_path: `${selfId}/${fileId}.png`,
            timezone: "America/Los_Angeles",
          },
          {
            id: partnerId,
            display_name: "Summer",
            avatar_path: "https://lh3.googleusercontent.com/a/photo",
            timezone: "America/New_York",
          },
        ]),
        circle_invites: queryResult({
          id: "66666666-6666-4666-8666-666666666666",
          expires_at: "2026-11-23T00:00:00.000Z",
          max_uses: 1,
          use_count: 1,
          revoked_at: null,
        }),
      },
    });

    const circle = await loadCircle(session, circleId);
    expect(circle?.title).toBe("Your circle");
    expect(circle?.members.map((member) => member.avatarUrl)).toEqual([
      "https://example.com/signed.png",
      "https://lh3.googleusercontent.com/a/photo",
    ]);
    expect(signed).toBe(1);
    expect(circle?.invite?.maxUses).toBe(1);
  });

  it("does not sign a path outside that member's folder", async () => {
    let signed = 0;
    const session = fakeSession({
      userId: selfId,
      onSignedUrl: () => {
        signed += 1;
      },
      tables: {
        circles: queryResult({
          id: circleId,
          name: "Me & Summer",
          circle_type: "couple",
          status: "pending",
          created_at: "2026-11-16T00:00:00.000Z",
        }),
        circle_members: queryResult([
          {
            user_id: selfId,
            joined_at: "2026-11-16T00:00:00.000Z",
            left_at: null,
          },
        ]),
        profiles: queryResult([
          {
            id: selfId,
            display_name: "Isaac",
            avatar_path: `${partnerId}/${fileId}.png`,
            timezone: "UTC",
          },
        ]),
        circle_invites: queryResult(null),
      },
    });

    const circle = await loadCircle(session, circleId);
    expect(circle?.members[0]?.avatarUrl).toBeNull();
    expect(signed).toBe(0);
    expect(circle?.invite).toBeNull();
  });

  it("returns null when the circle cannot be read", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        circles: queryResult(null, { message: "missing" }),
      },
    });
    expect(await loadCircle(session, circleId)).toBeNull();
  });
});
