import { describe, expect, it } from "vitest";

import {
  feedbackBodySchema,
  feedbackWriteFailure,
} from "@/lib/feedback/fields";
import { feedbackPromptEligible } from "@/lib/feedback/prompt";

const now = new Date("2026-10-19T12:00:00.000Z");

describe("feedback body", () => {
  it("accepts a rating and drops an empty note", () => {
    expect(feedbackBodySchema.parse({ rating: 5, message: "  " })).toEqual({
      rating: 5,
    });
    expect(
      feedbackBodySchema.parse({
        rating: 2,
        message: "The tab bar overlaps the sheet.",
        category: "bug",
      }),
    ).toEqual({
      rating: 2,
      message: "The tab bar overlaps the sheet.",
      category: "bug",
    });
  });

  it("rejects content that is not a rating, a short note, or a category", () => {
    expect(feedbackBodySchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(
      feedbackBodySchema.safeParse({ rating: 3, message: "x".repeat(1001) })
        .success,
    ).toBe(false);
    expect(
      feedbackBodySchema.safeParse({ rating: 3, category: "rant" }).success,
    ).toBe(false);
    expect(
      feedbackBodySchema.safeParse({ rating: 3, email: "a@b.c" }).success,
    ).toBe(false);
    expect(feedbackWriteFailure("hsummer_feedback_rate_limited")).toMatch(
      /Wait/,
    );
  });
});

describe("feedback prompt", () => {
  it("waits seven days or ten letters, and never returns after a dismissal", () => {
    expect(
      feedbackPromptEligible({
        dismissed: false,
        demo: false,
        accountCreatedAt: "2026-10-18T12:00:00.000Z",
        lettersSent: 3,
        now,
      }),
    ).toBe(false);

    expect(
      feedbackPromptEligible({
        dismissed: false,
        demo: false,
        accountCreatedAt: "2026-10-12T12:00:00.000Z",
        lettersSent: 0,
        now,
      }),
    ).toBe(true);

    expect(
      feedbackPromptEligible({
        dismissed: false,
        demo: false,
        accountCreatedAt: "2026-10-18T12:00:00.000Z",
        lettersSent: 10,
        now,
      }),
    ).toBe(true);

    expect(
      feedbackPromptEligible({
        dismissed: true,
        demo: false,
        accountCreatedAt: "2026-01-01T00:00:00.000Z",
        lettersSent: 40,
        now,
      }),
    ).toBe(false);

    expect(
      feedbackPromptEligible({
        dismissed: false,
        demo: true,
        accountCreatedAt: "2026-01-01T00:00:00.000Z",
        lettersSent: 40,
        now,
      }),
    ).toBe(false);
  });
});
