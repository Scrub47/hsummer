import { describe, expect, it } from "vitest";

import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";

const row = (id: string) => ({
  id,
  endpoint: `https://push.example/${id}`,
  p256dh: "p256dh-key",
  auth: "auth-key",
});

describe("subscription pruning", () => {
  it("keeps successful and temporary failures, and drops 404 and 410", () => {
    const ids = subscriptionsToPrune([
      { id: "ok", statusCode: 201 },
      { id: "missing", statusCode: 404 },
      { id: "gone", statusCode: 410 },
      { id: "rate-limited", statusCode: 429 },
      { id: "offline", statusCode: null },
    ]);

    expect(ids).toEqual(["missing", "gone"]);
  });

  it("records a thrown web-push status and still sends to the next device", async () => {
    const sent: string[] = [];
    const results = await deliverTestPushes(
      [row("a"), row("b"), row("c")],
      '{"title":"Hsummer"}',
      async (subscription) => {
        sent.push(subscription.endpoint);
        if (subscription.endpoint.endsWith("/a")) {
          throw Object.assign(new Error("gone"), { statusCode: 410 });
        }
        if (subscription.endpoint.endsWith("/b")) {
          throw new Error("network down");
        }
        return 201;
      },
    );

    expect(sent).toEqual([
      "https://push.example/a",
      "https://push.example/b",
      "https://push.example/c",
    ]);
    expect(results).toEqual([
      { id: "a", statusCode: 410 },
      { id: "b", statusCode: null },
      { id: "c", statusCode: 201 },
    ]);
    expect(subscriptionsToPrune(results)).toEqual(["a"]);
  });
});
