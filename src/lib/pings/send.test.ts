import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { PING_LIMIT, PING_RATE_LIMIT_MESSAGE } from "@/lib/pings/fields";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/session", () => ({
  getSession,
}));

import { POST } from "@/app/api/pings/route";
import { sendThinkingOfYou } from "@/lib/pings/send";
import type { Session } from "@/lib/supabase/session";

const circleId = "11111111-1111-4111-8111-111111111111";
const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

function query(result: Result) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const name of ["select", "eq", "is", "gt", "limit", "insert"]) {
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

function session(
  results: Record<string, Result>,
  pings?: { count: Result; insert: Result },
): Session {
  let pingReads = 0;
  return {
    userId: selfId,
    supabase: {
      from(table: string) {
        if (table === "pings" && pings) {
          pingReads += 1;
          return query(pingReads === 1 ? pings.count : pings.insert);
        }
        const result = results[table];
        if (!result) throw new Error(`unexpected table ${table}`);
        return query(result);
      },
    } as unknown as Session["supabase"],
  };
}

const couple = {
  data: { id: circleId, circle_type: "couple", status: "active" },
  error: null,
};
const members = {
  data: [{ user_id: selfId }, { user_id: partnerId }],
  error: null,
};

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_SUBJECT;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("Thinking of You 429", () => {
  it("returns a friendly 429 when this person is already at the cap", async () => {
    const current = session({
      circles: couple,
      circle_members: members,
      pings: { data: null, error: null, count: PING_LIMIT },
    });
    getSession.mockResolvedValue(current);

    const direct = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
    });
    expect(direct).toEqual({
      status: 429,
      body: { error: PING_RATE_LIMIT_MESSAGE },
    });

    const response = await POST(
      new Request("https://hsummer.vercel.app/api/pings", {
        method: "POST",
        body: JSON.stringify({ circleId }),
      }),
    );
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: PING_RATE_LIMIT_MESSAGE,
    });
  });

  it("returns 429 when the database trigger refuses the insert", async () => {
    const current = session(
      {
        circles: couple,
        circle_members: members,
      },
      {
        count: { data: null, error: null, count: PING_LIMIT - 1 },
        insert: {
          data: null,
          error: { message: "hsummer_rate_limited", code: "P0001" },
        },
      },
    );

    const result = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
    });
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: PING_RATE_LIMIT_MESSAGE });
  });

  it("counts a shared mood toward the same cap", async () => {
    const current = session({
      circles: couple,
      circle_members: members,
      pings: { data: null, error: null, count: PING_LIMIT },
    });
    const result = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
      moodEmoji: "😊",
    });
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: PING_RATE_LIMIT_MESSAGE });
  });

  it("refuses an unknown mood before it spends the rate limit", async () => {
    const current = session({
      circles: couple,
      circle_members: members,
      pings: { data: null, error: null, count: 0 },
    });
    const result = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
      moodEmoji: "not-a-mood",
    });
    expect(result.status).toBe(400);
  });

  it("inserts a mood-share row and still asks for the generic push", async () => {
    let inserted: unknown = null;
    const current: Session = {
      userId: selfId,
      supabase: {
        from(table: string) {
          if (table === "circles") return query(couple);
          if (table === "circle_members") return query(members);
          if (table === "pings") {
            const builder: Record<string, unknown> = {};
            const chain = () => builder;
            for (const name of ["select", "eq", "is", "gt", "limit"]) {
              builder[name] = chain;
            }
            builder.insert = (row: unknown) => {
              inserted = row;
              return query({
                data: {
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  secret_variant: false,
                },
                error: null,
              });
            };
            builder.maybeSingle = () =>
              Promise.resolve({ data: null, error: null, count: 0 });
            builder.single = () =>
              Promise.resolve({ data: null, error: null, count: 0 });
            builder.then = (
              resolve: (value: Result) => unknown,
              reject?: (reason: unknown) => unknown,
            ) =>
              Promise.resolve({ data: null, error: null, count: 0 }).then(
                resolve,
                reject,
              );
            return builder;
          }
          throw new Error(`unexpected table ${table}`);
        },
      } as unknown as Session["supabase"],
    };

    const result = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
      moodEmoji: "🥰",
    });
    expect(result.status).toBe(200);
    expect(inserted).toMatchObject({
      ping_type: "mood-share",
      mood_emoji: "🥰",
      secret_variant: false,
      to_user_id: partnerId,
    });
    if (result.status === 200 && "ok" in result.body) {
      expect(result.body.push).toBe("unconfigured");
      expect(JSON.stringify(result.body)).not.toContain("🥰");
    }
  });

  it("fails closed when the count cannot be read", async () => {
    const current = session({
      circles: couple,
      circle_members: members,
      pings: { data: null, error: null, count: null },
    });
    const result = await sendThinkingOfYou(current, {
      circleId,
      secretVariant: false,
      origin: "https://hsummer.vercel.app",
    });
    expect(result.status).toBe(503);
  });
});
