import { describe, expect, it } from "vitest";

import { loadBucketItems } from "@/lib/bucket/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";

const names = new Map([
  [selfId, "Isaac"],
  [partnerId, "Summer"],
]);

function item(overrides: Record<string, unknown>) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Ramen",
    category: "restaurant",
    status: "idea",
    planned_date: null,
    completed_at: null,
    notes: null,
    link: null,
    created_by: selfId,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadBucketItems", () => {
  it("sorts idea, then planned by date, then done, and labels the author", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        bucket_items: queryResult([
          item({
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            title: "Done thing",
            status: "done",
            created_by: null,
            created_at: "2026-10-01T00:00:00.000Z",
          }),
          item({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Later plan",
            status: "planned",
            planned_date: null,
            created_by: partnerId,
            created_at: "2026-11-02T00:00:00.000Z",
          }),
          item({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            title: "Soon",
            status: "planned",
            planned_date: "2026-12-01",
            created_at: "2026-11-03T00:00:00.000Z",
          }),
          item({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Ramen",
            status: "idea",
            created_at: "2026-11-04T00:00:00.000Z",
          }),
          item({
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            title: "Nope",
            category: "not-a-category",
          }),
        ]),
      },
    });

    const loaded = await loadBucketItems(session, circleId, names);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.items.map((row) => row.title)).toEqual([
      "Ramen",
      "Soon",
      "Later plan",
      "Done thing",
    ]);
    expect(loaded.items.map((row) => row.author)).toEqual([
      "you",
      "you",
      "Summer",
      "Former member",
    ]);
  });

  it("drops a link that is not a plain http(s) URL", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        bucket_items: queryResult([
          item({ link: "javascript:alert(1)" }),
          item({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            link: "https://example.com/ramen",
          }),
        ]),
      },
    });
    const loaded = await loadBucketItems(session, circleId, names);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.items.map((row) => row.link)).toEqual([
      null,
      "https://example.com/ramen",
    ]);
  });

  it("returns an empty failure when the table cannot be read", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        bucket_items: queryResult(null, { message: "missing", code: "42P01" }),
      },
    });
    const loaded = await loadBucketItems(session, circleId, names);
    expect(loaded).toEqual({ ok: false, items: [] });
  });
});
