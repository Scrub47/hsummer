import { describe, expect, it } from "vitest";

import { MEMORY_SIGNED_URL_SECONDS } from "@/lib/memories/fields";
import { loadMemories } from "@/lib/memories/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";
const memoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const photoPath = `${circleId}/${memoryId}.jpg`;

describe("loadMemories", () => {
  it("signs a photo for five minutes and drops a kind it does not know", async () => {
    let signedFor = 0;
    const session = fakeSession({
      userId: selfId,
      tables: {
        memories: queryResult([
          {
            id: memoryId,
            created_by: partnerId,
            kind: "photo",
            body: "Dock",
            photo_path: photoPath,
            photo_bytes: 12,
            tags: ["summer"],
            visibility: "circle",
            occurred_on: "2026-10-14",
            created_at: "2026-10-14T18:00:00.000Z",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            created_by: selfId,
            kind: "voice",
            body: "nope",
            photo_path: null,
            photo_bytes: 0,
            tags: [],
            visibility: "circle",
            occurred_on: "2026-10-14",
            created_at: "2026-10-14T19:00:00.000Z",
          },
        ]),
        memory_viewers: queryResult([]),
      },
      rpc: queryResult(12),
      signedUrl: {
        signedUrl: "https://example.com/signed",
        error: null,
      },
      onSignedUrl: ({ path, expiresIn }) => {
        expect(path).toBe(photoPath);
        signedFor = expiresIn;
      },
    });

    const loaded = await loadMemories(
      session,
      circleId,
      new Map([[partnerId, "Summer"]]),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(signedFor).toBe(MEMORY_SIGNED_URL_SECONDS);
    expect(loaded.wall.usedBytes).toBe(12);
    expect(loaded.wall.memories).toHaveLength(1);
    expect(loaded.wall.memories[0]).toMatchObject({
      author: "Summer",
      photoUrl: "https://example.com/signed",
      mine: false,
    });
  });

  it("refuses a signed URL that is not displayable and names the author", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        memories: queryResult([
          {
            id: memoryId,
            created_by: selfId,
            kind: "photo",
            body: null,
            photo_path: photoPath,
            photo_bytes: 4,
            tags: [],
            visibility: "selected",
            occurred_on: "2026-10-14",
            created_at: "2026-10-14T18:00:00.000Z",
          },
        ]),
        memory_viewers: queryResult([
          { memory_id: memoryId, user_id: partnerId },
        ]),
      },
      signedUrl: {
        signedUrl: "javascript:alert(1)",
        error: null,
      },
    });

    const loaded = await loadMemories(
      session,
      circleId,
      new Map([[partnerId, "Summer"]]),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.wall.memories[0]).toMatchObject({
      photoUrl: null,
      mine: true,
      viewerNames: ["Summer"],
      author: "you",
    });
  });

  it("reports the wall missing when the table is not there", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        memories: queryResult(null, {
          message: "relation does not exist",
          code: "42P01",
        }),
        memory_viewers: queryResult([]),
      },
    });
    const loaded = await loadMemories(session, circleId, new Map());
    expect(loaded).toEqual({ ok: false, wall: null });
  });
});
