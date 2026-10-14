import { describe, expect, it } from "vitest";

import { MOODS } from "@/lib/moods/fields";
import {
  buildLetterNotification,
  buildPingNotification,
  buildTestNotification,
  LETTER_NOTIFICATION_BODY,
  PING_NOTIFICATION_BODY,
  PING_SECRET_NOTIFICATION_BODY,
  TEST_NOTIFICATION_BODY,
} from "@/lib/push/payload";

describe("buildTestNotification", () => {
  it("builds a generic lock-screen payload with no private fields", () => {
    const notification = buildTestNotification("https://hsummer.example");

    expect(notification).toEqual({
      title: "Hsummer",
      body: TEST_NOTIFICATION_BODY,
      url: "https://hsummer.example/home",
    });
    expect(Object.keys(notification).sort()).toEqual(["body", "title", "url"]);

    const serialized = JSON.stringify(notification);
    expect(serialized.length).toBeLessThan(1024);
    expect(serialized.toLowerCase()).not.toContain("email");
    expect(serialized).not.toContain("@");
  });

  it("ignores a path on the origin so the click target stays on /home", () => {
    const notification = buildTestNotification(
      "https://hsummer.example/sign-in?next=/secret",
    );
    expect(notification.url).toBe("https://hsummer.example/home");
  });
});

describe("buildPingNotification", () => {
  const circleId = "11111111-1111-4111-8111-111111111111";

  it("uses a fixed sentence and opens the circle, with no name in the payload", () => {
    const notification = buildPingNotification("https://hsummer.example", {
      secretVariant: false,
      circleId,
    });

    expect(notification).toEqual({
      title: "Hsummer",
      body: PING_NOTIFICATION_BODY,
      url: `https://hsummer.example/circles/${circleId}`,
    });
    expect(JSON.stringify(notification)).not.toContain("@");
    expect(JSON.stringify(notification)).not.toContain("Summer");
    for (const mood of MOODS) {
      expect(notification.body).not.toContain(mood.emoji);
      expect(notification.body).not.toContain(mood.label);
    }
  });

  it("switches the secret variant to Missing you and still omits the name", () => {
    const notification = buildPingNotification(
      "https://hsummer.example/sign-in",
      { secretVariant: true, circleId },
    );
    expect(notification.body).toBe(PING_SECRET_NOTIFICATION_BODY);
    expect(notification.body).not.toContain("Summer");
    expect(notification.url).toBe(
      `https://hsummer.example/circles/${circleId}`,
    );
  });

  it("refuses to put a non-id into the click target", () => {
    const notification = buildPingNotification("https://hsummer.example", {
      secretVariant: false,
      circleId: "https://evil.example",
    });
    expect(notification.url).toBe("https://hsummer.example/home");
  });
});

describe("buildLetterNotification", () => {
  const circleId = "11111111-1111-4111-8111-111111111111";

  it("says a letter arrived and leaves the words out", () => {
    const notification = buildLetterNotification(
      "https://hsummer.example",
      circleId,
    );

    expect(notification).toEqual({
      title: "Hsummer",
      body: LETTER_NOTIFICATION_BODY,
      url: `https://hsummer.example/circles/${circleId}`,
    });
    const serialized = JSON.stringify(notification);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("Dear");
    expect(serialized).not.toContain("Summer");
    expect(notification.body).toBe("You have a new letter.");
  });
});
