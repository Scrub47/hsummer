import { describe, expect, it } from "vitest";

import {
  parsePushSubscription,
  urlBase64ToUint8Array,
} from "@/lib/push/subscription";

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device",
  keys: {
    p256dh:
      "BL7ELU24fJTAlH5Kyl8N6BDCac8u8li_U5PIwG963MOvdYs9s7LSzj8x_7v7RFdLZ9Eap50PiiyF5K0TDAis7t0",
    auth: "juarI8x__VnHvsOgfeAPHg",
  },
};

describe("parsePushSubscription", () => {
  it("accepts a PushSubscription JSON object", () => {
    expect(parsePushSubscription(valid)).toEqual({
      endpoint: valid.endpoint,
      p256dh: valid.keys.p256dh,
      auth: valid.keys.auth,
    });
  });

  it("rejects non-https endpoints and unexpected shapes", () => {
    expect(
      parsePushSubscription({
        ...valid,
        endpoint: "http://push.example/device",
      }),
    ).toBeNull();
    expect(parsePushSubscription({ endpoint: valid.endpoint })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
    expect(
      parsePushSubscription({
        ...valid,
        keys: { ...valid.keys, auth: "not a key!" },
      }),
    ).toBeNull();
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a VAPID public key to the 65-byte uncompressed P-256 point", () => {
    const publicKey =
      "BGtkbcjrO12YMoDuq2sCQeHlu47uPx3SHTgFKZFYiBW8Qr0D9vgyZSZPdw6_4ZFEI9Snk1VEAj2qTYI1I1YxBXE";
    expect(urlBase64ToUint8Array(publicKey)).toHaveLength(65);
    expect(urlBase64ToUint8Array(publicKey)[0]).toBe(0x04);
  });
});
