/**
 * Current-mood rules shared by the circle page, the server action, and the
 * tests.
 *
 * The database checks the same emoji list. Saving a mood does not send a
 * push. The optional share is a mood-share ping, and that ping uses the
 * Thinking of You rate limit and the same lock-screen sentence.
 */

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";

export const MOODS = [
  { emoji: "😊", label: "Good" },
  { emoji: "😌", label: "Calm" },
  { emoji: "🥰", label: "Loved" },
  { emoji: "😴", label: "Tired" },
  { emoji: "😔", label: "Low" },
  { emoji: "✨", label: "Excited" },
] as const;

export type MoodEmoji = (typeof MOODS)[number]["emoji"];

export const MOOD_PICK_ERROR = "Pick one of the moods.";
export const MOOD_UNAVAILABLE =
  "Moods aren't available yet. Apply the week 7 SQL in the Supabase SQL editor, then try again.";
export const MOOD_FORBIDDEN = "You can't set that mood.";

export type MoodPush = "sent" | "unconfigured" | "none" | "failed";

const moodEmojiSchema = z.enum(["😊", "😌", "🥰", "😴", "😔", "✨"]);

export function isMoodEmoji(value: string): value is MoodEmoji {
  return moodEmojiSchema.safeParse(value).success;
}

export function moodLabel(emoji: string): string | null {
  return MOODS.find((mood) => mood.emoji === emoji)?.label ?? null;
}

export { isCircleId };

/** Maps a Postgres error from a mood write onto a sentence, or null. */
export function moodWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  const demo = demoWriteMessage(message);
  if (demo) return demo;
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    (message?.includes("current_moods") && message.includes("schema"))
  ) {
    return MOOD_UNAVAILABLE;
  }
  if (
    message?.includes("current_moods_emoji_known") ||
    message?.includes("hsummer_mood_locked") ||
    message?.includes("hsummer_mood_not_owner")
  ) {
    return MOOD_PICK_ERROR;
  }
  if (
    message?.includes("row-level security") ||
    message?.includes("42501") ||
    code === "42501"
  ) {
    return MOOD_FORBIDDEN;
  }
  return null;
}

/**
 * Status line after a mood save. Sharing uses the same push outcomes as
 * Thinking of You. The default path says that no notification was sent.
 */
export function moodSavedMessage(input: {
  partnerName: string | null;
  waiting: boolean;
  shared: boolean;
  push: MoodPush | null;
}): string {
  if (!input.shared) {
    if (input.waiting) {
      return "Saved. They'll see it when they join. No notification was sent.";
    }
    if (input.partnerName) {
      return `Saved. ${input.partnerName} can see it here. No notification was sent.`;
    }
    return "Saved. The circle can see it here. No notification was sent.";
  }

  const who = input.partnerName ?? "your partner";
  if (input.push === "unconfigured") {
    return `Saved, and shared with ${who}. Notifications aren't configured on the server yet.`;
  }
  if (input.push === "none") {
    return `Saved, and shared with ${who}. They'll see it here. Their phone buzzes after they turn notifications on.`;
  }
  if (input.push === "sent") {
    return `Saved, and sent to ${who}.`;
  }
  return `Saved, and shared with ${who}. Their devices couldn't be reached just now.`;
}
