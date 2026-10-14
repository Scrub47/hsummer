import { describe, expect, it } from "vitest";

import { loadLetters } from "@/lib/letters/load";
import { fakeSession, queryResult } from "@/test/fake-supabase";

const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const circleId = "11111111-1111-4111-8111-111111111111";

describe("loadLetters", () => {
  it("hides an unopened body from the recipient and keeps the sender's", () => {
    const session = fakeSession({
      userId: partnerId,
      tables: {
        letters: queryResult([
          letter({
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            from_user_id: selfId,
            to_user_id: partnerId,
            body: "The ferry is still ours.",
            opened_at: null,
          }),
        ]),
        letter_categories: queryResult([
          { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Rainy days" },
        ]),
      },
    });

    return loadLetters(
      session,
      circleId,
      new Map([
        [selfId, "Isaac"],
        [partnerId, "Summer"],
      ]),
    ).then((loaded) => {
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.letters).toHaveLength(1);
      expect(loaded.letters[0]).toMatchObject({
        sealed: true,
        body: null,
        dearName: "Dear Summer",
        fromName: "Isaac",
        categoryLabel: "Need motivation",
      });
      expect(JSON.stringify(loaded.letters)).not.toContain(
        "The ferry is still ours.",
      );
    });
  });

  it("shows the sender the body, including a custom category", async () => {
    const session = fakeSession({
      userId: selfId,
      tables: {
        letters: queryResult([
          letter({
            category: "Rainy days",
            opened_at: "2026-12-21T18:00:00.000Z",
          }),
        ]),
        letter_categories: queryResult([
          { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Rainy days" },
        ]),
      },
    });

    const loaded = await loadLetters(
      session,
      circleId,
      new Map([[partnerId, "Summer"]]),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.letters[0]).toMatchObject({
      mine: true,
      sealed: false,
      body: "The ferry is still ours.",
      dearName: "Dear Summer",
      categoryLabel: "Rainy days",
    });
  });
});

function letter(
  overrides: Partial<{
    id: string;
    from_user_id: string | null;
    to_user_id: string;
    category: string;
    title: string | null;
    body: string;
    design: string;
    scheduled_for: string | null;
    status: string;
    delivered_at: string | null;
    opened_at: string | null;
    created_at: string;
  }> = {},
) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    from_user_id: selfId,
    to_user_id: partnerId,
    category: "need-motivation",
    title: "For the ferry",
    body: "The ferry is still ours.",
    design: "kawaii",
    scheduled_for: null,
    status: "delivered",
    delivered_at: "2026-12-21T17:00:00.000Z",
    opened_at: null,
    created_at: "2026-12-21T17:00:00.000Z",
    ...overrides,
  };
}
