import { z } from "zod";

export const FEEDBACK_CATEGORIES = ["bug", "idea", "love"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MESSAGE_MAX = 1000;
export const FEEDBACK_LIMIT = 5;
export const FEEDBACK_WINDOW_MINUTES = 60;

export const FEEDBACK_RATE_LIMIT_MESSAGE =
  "You've sent a few notes just now. Wait a little and try again.";

export const feedbackBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    message: z
      .string()
      .trim()
      .max(FEEDBACK_MESSAGE_MAX)
      .optional()
      .transform((value) => (value ? value : undefined)),
    category: z.enum(FEEDBACK_CATEGORIES).optional(),
  })
  .strict();

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

export function feedbackWriteFailure(
  message: string | undefined,
): string | null {
  if (!message) return null;
  if (message.includes("hsummer_feedback_rate_limited")) {
    return FEEDBACK_RATE_LIMIT_MESSAGE;
  }
  if (message.includes("hsummer_demo_readonly")) {
    return "The demo can't send feedback.";
  }
  return null;
}
