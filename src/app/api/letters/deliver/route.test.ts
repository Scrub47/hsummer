import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyQstashRequest = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());
const notifyLetterRecipient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/schedule/qstash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/schedule/qstash")>();
  return {
    ...actual,
    verifyQstashRequest,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient,
}));

vi.mock("@/lib/letters/notify", () => ({
  notifyLetterRecipient,
}));

import { getSiteUrl } from "@/lib/env";

import { POST } from "./route";

const letterId = "11111111-1111-4111-8111-111111111111";

function request(body: string, signature: string | null = "signed") {
  return new Request("https://hsummer.vercel.app/api/letters/deliver", {
    method: "POST",
    headers: signature ? { "upstash-signature": signature } : {},
    body,
  });
}

beforeEach(() => {
  verifyQstashRequest.mockReset();
  createAdminClient.mockReset();
  notifyLetterRecipient.mockReset();
  notifyLetterRecipient.mockResolvedValue(undefined);
});

describe("POST /api/letters/deliver", () => {
  it("refuses an unsigned body before it touches the database", async () => {
    verifyQstashRequest.mockResolvedValue(false);
    const response = await POST(request(JSON.stringify({ letterId })));
    expect(response.status).toBe(401);
    expect(verifyQstashRequest).toHaveBeenCalledWith({
      signature: "signed",
      body: JSON.stringify({ letterId }),
      url: "https://hsummer.vercel.app/api/letters/deliver",
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(notifyLetterRecipient).not.toHaveBeenCalled();
  });

  it("delivers once and pushes the fixed sentence", async () => {
    verifyQstashRequest.mockResolvedValue(true);
    const rpc = vi.fn(async () => ({ data: "delivered", error: null }));
    createAdminClient.mockReturnValue({
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                to_user_id: "22222222-2222-4222-8222-222222222222",
                circle_id: "33333333-3333-4333-8333-333333333333",
              },
              error: null,
            }),
          }),
        }),
      }),
    });

    const response = await POST(request(JSON.stringify({ letterId })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: "delivered" });
    expect(rpc).toHaveBeenCalledWith("deliver_scheduled_letter", {
      target: letterId,
    });
    expect(notifyLetterRecipient).toHaveBeenCalledWith({
      recipientId: "22222222-2222-4222-8222-222222222222",
      origin: getSiteUrl() ?? "https://hsummer.vercel.app",
      circleId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("asks QStash to retry when the letter is not due yet", async () => {
    verifyQstashRequest.mockResolvedValue(true);
    createAdminClient.mockReturnValue({
      rpc: async () => ({ data: "early", error: null }),
      from: () => {
        throw new Error("should not read the letter");
      },
    });

    const response = await POST(
      request(JSON.stringify({ letterId, extra: true })),
    );
    expect(response.status).toBe(500);
    expect(notifyLetterRecipient).not.toHaveBeenCalled();
  });
});
