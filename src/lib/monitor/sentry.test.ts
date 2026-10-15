import { describe, expect, it } from "vitest";

import { parseSentryDsn } from "@/lib/monitor/sentry";

describe("parseSentryDsn", () => {
  it("builds the store URL from an https DSN", () => {
    expect(parseSentryDsn("https://abc123@o0.ingest.sentry.io/456")).toEqual({
      key: "abc123",
      storeUrl: "https://o0.ingest.sentry.io/api/456/store/",
    });
  });

  it("rejects a DSN that is not https or has no project id", () => {
    expect(parseSentryDsn("http://abc@o0.ingest.sentry.io/456")).toBeNull();
    expect(
      parseSentryDsn("https://abc@o0.ingest.sentry.io/not-a-number"),
    ).toBeNull();
    expect(parseSentryDsn("not a url")).toBeNull();
  });
});
