import { describe, expect, it } from "vitest";

import {
  PRODUCT_EVENTS,
  isProductEvent,
  sanitizeEventProperties,
} from "@/lib/analytics/events";
import { redactCapture } from "@/lib/analytics/redact";

describe("product events", () => {
  it("names the resume set and nothing else", () => {
    expect(PRODUCT_EVENTS).toEqual([
      "signed_up",
      "circle_created",
      "partner_joined",
      "letter_sent",
      "letter_opened",
      "ping_sent",
      "mood_shared",
      "booth_photo_taken",
      "strip_completed",
      "memory_added",
      "reaction_added",
      "reply_sent",
      "keepsake_exported",
      "push_enabled",
    ]);
    expect(isProductEvent("letter_sent")).toBe(true);
    expect(isProductEvent("letter_body")).toBe(false);
  });

  it("keeps labels and drops letter text, names, and email", () => {
    expect(
      sanitizeEventProperties({
        circle_type: "family",
        mode: "solo",
        body: "I miss you",
        email: "a@b.c",
        display_name: "Ada",
        circle_type_extra: "nope",
      }),
    ).toEqual({ circle_type: "family", mode: "solo" });

    expect(sanitizeEventProperties({ circle_type: "school" })).toEqual({});
    expect(sanitizeEventProperties(undefined)).toEqual({});
  });
});

describe("capture redaction", () => {
  it("drops autocapture and strips identity fields", () => {
    expect(
      redactCapture({
        event: "$autocapture",
        properties: { $el_text: "Dear Summer" },
      }),
    ).toBeNull();

    const kept = redactCapture({
      event: "letter_sent",
      properties: { email: "a@b.c", circle_type: "couple" },
      $set: { name: "Ada", plan: "beta" },
      $set_once: { display_name: "Ada" },
    });
    expect(kept?.properties).toEqual({ circle_type: "couple" });
    expect(kept?.$set).toEqual({ plan: "beta" });
    expect(kept?.$set_once).toEqual({});
  });
});
