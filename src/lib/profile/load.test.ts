import { describe, expect, it } from "vitest";

import { loadOwnProfile } from "@/lib/profile/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const fileId = "44444444-4444-4444-8444-444444444444";

describe("loadOwnProfile", () => {
  it("returns a signed URL for the caller's own object", async () => {
    const session = fakeSession({
      userId: selfId,
      signedUrl: {
        signedUrl: "https://example.com/me.png",
        error: null,
      },
      tables: {
        profiles: queryResult({
          display_name: "Isaac",
          avatar_path: `${selfId}/${fileId}.png`,
          timezone: "America/Los_Angeles",
        }),
      },
    });

    expect(await loadOwnProfile(session)).toEqual({
      displayName: "Isaac",
      timezone: "America/Los_Angeles",
      hasAvatar: true,
      avatarUrl: "https://example.com/me.png",
    });
  });

  it("keeps a legacy https photo and refuses a signed URL that is not displayable", async () => {
    const legacy = fakeSession({
      userId: selfId,
      tables: {
        profiles: queryResult({
          display_name: "Isaac",
          avatar_path: "https://lh3.googleusercontent.com/a/photo",
          timezone: "UTC",
        }),
      },
    });
    expect((await loadOwnProfile(legacy))?.avatarUrl).toBe(
      "https://lh3.googleusercontent.com/a/photo",
    );

    const bad = fakeSession({
      userId: selfId,
      signedUrl: {
        signedUrl: "javascript:alert(1)",
        error: null,
      },
      tables: {
        profiles: queryResult({
          display_name: "Isaac",
          avatar_path: `${selfId}/${fileId}.webp`,
          timezone: "UTC",
        }),
      },
    });
    const loaded = await loadOwnProfile(bad);
    expect(loaded?.hasAvatar).toBe(true);
    expect(loaded?.avatarUrl).toBeNull();
  });

  it("returns null when the row is missing", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: { profiles: queryResult(null) },
    });
    expect(await loadOwnProfile(session)).toBeNull();
  });
});
