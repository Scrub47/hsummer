import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "host" ? "127.0.0.1:3000" : null),
  }),
}));

const getSession = vi.hoisted(() => vi.fn());
const notifyLetterRecipient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/session", () => ({
  getSession,
}));

vi.mock("@/lib/letters/notify", () => ({
  notifyLetterRecipient,
}));

vi.mock("@/lib/rate-limit/enforce", () => ({
  enforceSharedLimit: vi.fn(async () => ({ ok: true, source: "database" })),
}));

import {
  openLetter,
  sendLetter,
  type LetterActionState,
} from "./letter-actions";

const circleId = "11111111-1111-4111-8111-111111111111";
const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const letterId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const previous: LetterActionState = { error: null, saved: false };

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

function query(result: Result, onInsert?: (payload: unknown) => void) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.insert = (payload: unknown) => {
    onInsert?.(payload);
    return builder;
  };
  for (const name of ["select", "eq", "is", "gt", "order", "limit", "delete"]) {
    builder[name] = chain;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  builder.then = (
    resolve: (value: Result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  getSession.mockReset();
  notifyLetterRecipient.mockReset();
  notifyLetterRecipient.mockResolvedValue(undefined);
});

describe("sendLetter", () => {
  it("writes to the partner and does not take a recipient from the form", async () => {
    const inserted: unknown[] = [];
    let letterReads = 0;
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: {
        from(table: string) {
          if (table === "letter_categories") {
            return query({ data: [], error: null });
          }
          if (table === "circles") {
            return query({
              data: { circle_type: "couple", status: "active" },
              error: null,
            });
          }
          if (table === "circle_members") {
            return query({
              data: [{ user_id: selfId }, { user_id: partnerId }],
              error: null,
            });
          }
          if (table === "letters") {
            letterReads += 1;
            return query(
              letterReads === 1
                ? { data: null, error: null, count: 0 }
                : { data: { id: letterId }, error: null },
              (payload) => inserted.push(payload),
            );
          }
          throw new Error(table);
        },
      },
    });

    const state = await sendLetter(
      previous,
      form({
        circleId,
        category: "need-motivation",
        title: "For the ferry",
        body: "The ferry is still ours.",
        design: "kawaii",
        toUserId: "44444444-4444-4444-8444-444444444444",
      }),
    );

    expect(state).toEqual({ error: null, saved: true, notice: null });
    expect(inserted).toEqual([
      {
        circle_id: circleId,
        from_user_id: selfId,
        to_user_id: partnerId,
        category: "need-motivation",
        title: "For the ferry",
        body: "The ferry is still ours.",
        design: "kawaii",
      },
    ]);
    expect(notifyLetterRecipient).toHaveBeenCalledWith({
      recipientId: partnerId,
      origin: "http://127.0.0.1:3000",
      circleId,
    });
  });

  it("asks for the invite while the circle is still pending", async () => {
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: {
        from(table: string) {
          if (table === "letter_categories")
            return query({ data: [], error: null });
          if (table === "circles") {
            return query({
              data: { circle_type: "couple", status: "pending" },
              error: null,
            });
          }
          if (table === "circle_members") {
            return query({ data: [{ user_id: selfId }], error: null });
          }
          throw new Error(table);
        },
      },
    });

    const state = await sendLetter(
      previous,
      form({
        circleId,
        category: "feeling-sad",
        title: "",
        body: "Hello",
        design: "minimal",
      }),
    );

    expect(state.saved).toBe(false);
    expect(state.error).toMatch(/invite link/i);
    expect(notifyLetterRecipient).not.toHaveBeenCalled();
  });
});

describe("openLetter", () => {
  it("returns the body only after the letter is opened", async () => {
    getSession.mockResolvedValue({
      userId: partnerId,
      supabase: {
        rpc: async () => ({ data: "memory-id", error: null }),
        from(table: string) {
          if (table !== "letters") throw new Error(table);
          return query({
            data: {
              circle_id: circleId,
              to_user_id: partnerId,
              title: "For the ferry",
              body: "The ferry is still ours.",
              opened_at: "2026-12-21T18:00:00.000Z",
            },
            error: null,
          });
        },
      },
    });

    const opened = await openLetter(circleId, letterId);
    expect(opened).toEqual({
      error: null,
      body: "The ferry is still ours.",
      title: "For the ferry",
    });
  });

  it("does not return the body when open is refused", async () => {
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: {
        rpc: async () => ({
          data: null,
          error: { message: "hsummer_letter_open", code: "P0001" },
        }),
        from() {
          throw new Error("should not read the letter");
        },
      },
    });

    const opened = await openLetter(circleId, letterId);
    expect(opened.body).toBeNull();
    expect(opened.title).toBeNull();
    expect(opened.error).toBeTruthy();
  });
});
