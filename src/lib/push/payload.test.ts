import { describe, expect, it } from "vitest";

import {
  buildTestNotification,
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
