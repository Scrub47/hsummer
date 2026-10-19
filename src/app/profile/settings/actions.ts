"use server";

import { z } from "zod";

import { getSession } from "@/lib/supabase/session";

const optOutSchema = z.object({ optedOut: z.boolean() }).strict();

export async function setAnalyticsOptOut(
  optedOut: boolean,
): Promise<{ error: string | null }> {
  const parsed = optOutSchema.safeParse({ optedOut });
  if (!parsed.success) return { error: "That choice wasn't saved." };

  const session = await getSession();
  if (!session) return { error: "Sign in required." };

  const { error } = await session.supabase
    .from("account_private")
    .update({ analytics_opt_out: parsed.data.optedOut })
    .eq("user_id", session.userId);

  if (error) {
    console.error("analytics opt-out failed.", error.code);
    return { error: "That choice wasn't saved." };
  }
  return { error: null };
}

const dismissSchema = z.object({}).strict();

/** Hides the one-time check-in. A later update cannot clear the timestamp. */
export async function dismissFeedbackPrompt(): Promise<void> {
  dismissSchema.parse({});
  const session = await getSession();
  if (!session) return;
  const { error } = await session.supabase
    .from("account_private")
    .update({ feedback_prompt_dismissed_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("feedback_prompt_dismissed_at", null);
  if (error) console.error("feedback prompt dismissal failed.", error.code);
}
