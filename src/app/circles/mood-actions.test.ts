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
const sendThinkingOfYou = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/session", () => ({
  getSession,
}));

vi.mock("@/lib/pings/send", () => ({
  sendThinkingOfYou,
}));

import { PING_RATE_LIMIT_MESSAGE } from "@/lib/pings/fields";

import { setCurrentMood, type MoodActionState } from "./mood-actions";

const circleId = "11111111-1111-4111-8111-111111111111";
const selfId = "22222222-2222-4222-8222-222222222222";
const previous: MoodActionState = {
  error: null,
  saved: false,
  shared: false,
  push: null,
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function client(result: {
  data: unknown;
  error: { message: string; code?: string } | null;
}) {
  const upserts: unknown[] = [];
  const supabase = {
    from(table: string) {
      if (table !== "current_moods")
        throw new Error(`unexpected table ${table}`);
      return {
        upsert(payload: unknown) {
          upserts.push(payload);
          const builder = {
            select() {
              return builder;
            },
            single: () => Promise.resolve(result),
          };
          return builder;
        },
      };
    },
  };
  return { upserts, supabase };
}

beforeEach(() => {
  getSession.mockReset();
  sendThinkingOfYou.mockReset();
});

describe("setCurrentMood", () => {
  it("saves your own row and does not ping when share is off", async () => {
    const db = client({ data: { emoji: "😊" }, error: null });
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: db.supabase,
    });

    const state = await setCurrentMood(
      previous,
      form({ circleId, emoji: "😊" }),
    );

    expect(state).toEqual({
      error: null,
      saved: true,
      shared: false,
      push: null,
    });
    expect(db.upserts).toEqual([
      { user_id: selfId, circle_id: circleId, emoji: "😊" },
    ]);
    expect(sendThinkingOfYou).not.toHaveBeenCalled();
  });

  it("shares through Thinking of You when the box is checked", async () => {
    const db = client({ data: { emoji: "😌" }, error: null });
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: db.supabase,
    });
    sendThinkingOfYou.mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        pingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        secretVariant: false,
        devices: 0,
        sent: 0,
        removed: 0,
        push: "unconfigured",
      },
    });

    const data = form({ circleId, emoji: "😌" });
    data.set("share", "on");
    const state = await setCurrentMood(previous, data);

    expect(state.saved).toBe(true);
    expect(state.shared).toBe(true);
    expect(state.push).toBe("unconfigured");
    expect(sendThinkingOfYou).toHaveBeenCalledWith(
      expect.objectContaining({ userId: selfId }),
      {
        circleId,
        secretVariant: false,
        origin: "http://127.0.0.1:3000",
        moodEmoji: "😌",
      },
    );
  });

  it("keeps the mood when the ping is rate limited", async () => {
    const db = client({ data: { emoji: "✨" }, error: null });
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: db.supabase,
    });
    sendThinkingOfYou.mockResolvedValue({
      status: 429,
      body: { error: PING_RATE_LIMIT_MESSAGE },
    });

    const data = form({ circleId, emoji: "✨" });
    data.set("share", "on");
    const state = await setCurrentMood(previous, data);

    expect(state.saved).toBe(true);
    expect(state.shared).toBe(false);
    expect(state.error).toBe(PING_RATE_LIMIT_MESSAGE);
  });

  it("refuses an emoji that is not a mood, before writing", async () => {
    const db = client({ data: null, error: null });
    getSession.mockResolvedValue({
      userId: selfId,
      supabase: db.supabase,
    });

    const state = await setCurrentMood(
      previous,
      form({ circleId, emoji: "someone@example.com" }),
    );
    expect(state.saved).toBe(false);
    expect(db.upserts).toEqual([]);
    expect(sendThinkingOfYou).not.toHaveBeenCalled();
  });
});
