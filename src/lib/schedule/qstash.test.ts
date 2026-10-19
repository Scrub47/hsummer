import { createHash, createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  publicDeliverUrl,
  publishLetterMessage,
  qstashCallbackUrl,
  verifyQstashRequest,
} from "@/lib/schedule/qstash";

const signingKey = "current-signing-key";
const nextKey = "next-signing-key-value";

function sha256Base64Url(body: string): string {
  return createHash("sha256").update(body).digest("base64url");
}

function signQstash(input: { body: string; url: string; key: string }): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      sub: input.url,
      body: sha256Base64Url(input.body),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", input.key)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

describe("qstashCallbackUrl", () => {
  it("keeps the callback and drops a query string", () => {
    expect(
      qstashCallbackUrl(
        "https://hsummer.vercel.app/api/letters/deliver?x=1#frag",
      ),
    ).toBe("https://hsummer.vercel.app/api/letters/deliver");
    expect(qstashCallbackUrl("not a url")).toBeNull();
  });
});

describe("verifyQstashRequest", () => {
  const body = JSON.stringify({
    letterId: "11111111-1111-4111-8111-111111111111",
  });
  const url = "https://hsummer.vercel.app/api/letters/deliver";

  afterEach(() => {
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it("accepts a signature for this URL and rejects one for another URL", async () => {
    process.env.QSTASH_TOKEN = "qstash-test-token";
    process.env.QSTASH_CURRENT_SIGNING_KEY = signingKey;
    process.env.QSTASH_NEXT_SIGNING_KEY = nextKey;

    const good = signQstash({ body, url, key: signingKey });
    await expect(
      verifyQstashRequest({ signature: good, body, url }),
    ).resolves.toBe(true);

    const other = signQstash({
      body,
      url: "https://evil.example/api/letters/deliver",
      key: signingKey,
    });
    await expect(
      verifyQstashRequest({ signature: other, body, url }),
    ).resolves.toBe(false);
    await expect(
      verifyQstashRequest({ signature: good, body, url: null }),
    ).resolves.toBe(false);
  });
});

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
