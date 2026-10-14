import { afterEach, describe, expect, it, vi } from "vitest";

import { publicDeliverUrl, publishLetterMessage } from "@/lib/schedule/qstash";

describe("publicDeliverUrl", () => {
  it("builds the callback only for a public https origin", () => {
    expect(publicDeliverUrl("http://localhost:3000")).toBeNull();
    expect(publicDeliverUrl("http://127.0.0.1:3000")).toBeNull();
    expect(publicDeliverUrl("https://hsummer.vercel.app")).toBe(
      "https://hsummer.vercel.app/api/letters/deliver",
    );
  });
});

describe("publish skips QStash when it is not configured", () => {
  const original = fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = original;
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it("does not call the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const id = await publishLetterMessage({
      letterId: "11111111-1111-4111-8111-111111111111",
      notBefore: 1_800_000_000,
      callbackUrl: "https://hsummer.vercel.app/api/letters/deliver",
    });
    expect(id).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
