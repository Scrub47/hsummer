import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyQstashRequest = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/schedule/qstash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/schedule/qstash")>();
  return { ...actual, verifyQstashRequest };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient,
}));

import { POST } from "./route";

const heldId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  verifyQstashRequest.mockReset();
  createAdminClient.mockReset();
});

describe("POST /api/quiet/release", () => {
  it("refuses an unsigned body before it touches the database", async () => {
    verifyQstashRequest.mockResolvedValue(false);
    const response = await POST(
      new Request("https://hsummer.vercel.app/api/quiet/release", {
        method: "POST",
        headers: { "upstash-signature": "signed" },
        body: JSON.stringify({ heldId }),
      }),
    );
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
