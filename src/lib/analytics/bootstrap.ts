import "server-only";

import type { Session } from "@/lib/supabase/session";
import { getSession } from "@/lib/supabase/session";

import {
  FEEDBACK_PROMPT_AFTER_DAYS,
  FEEDBACK_PROMPT_AFTER_LETTERS,
  feedbackPromptEligible,
} from "@/lib/feedback/prompt";

export type AnalyticsBootstrap = {
  userId: string | null;
  optedOut: boolean;
  /** False when the column could not be read. The browser preference stands. */
  preferenceKnown: boolean;
  demo: boolean;
  prompt: boolean;
};

const SIGNED_OUT: AnalyticsBootstrap = {
  userId: null,
  optedOut: false,
  preferenceKnown: true,
  demo: false,
  prompt: false,
};

/**
 * One read for the root layout. A missing migration, or a signed-out visit,
 * leaves product analytics off the failure path and skips the prompt.
 */
export async function loadAnalyticsBootstrap(): Promise<AnalyticsBootstrap> {
  const session = await getSession();
  if (!session) return SIGNED_OUT;

  const { data, error } = await session.supabase
    .from("account_private")
    .select(
      "analytics_opt_out, created_at, feedback_prompt_dismissed_at, is_demo",
    )
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error || !data) {
    return {
      userId: session.userId,
      optedOut: false,
      preferenceKnown: false,
      demo: false,
      prompt: false,
    };
  }

  const demo = data.is_demo === true;
  const dismissed = data.feedback_prompt_dismissed_at != null;
  let lettersSent = 0;
  if (!demo && !dismissed && !accountIsOldEnough(data.created_at)) {
    lettersSent = await countLetters(session);
  }

  return {
    userId: session.userId,
    optedOut: data.analytics_opt_out === true,
    preferenceKnown: true,
    demo,
    prompt: feedbackPromptEligible({
      dismissed,
      demo,
      accountCreatedAt: data.created_at,
      lettersSent,
      now: new Date(),
    }),
  };
}

function accountIsOldEnough(createdAt: string): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return (
    Date.now() - created >= FEEDBACK_PROMPT_AFTER_DAYS * 24 * 60 * 60 * 1000
  );
}

async function countLetters(session: Session): Promise<number> {
  const { count, error } = await session.supabase
    .from("letters")
    .select("id", { count: "exact", head: true })
    .eq("from_user_id", session.userId)
    .neq("status", "cancelled");
  if (error || count == null) return 0;
  return count >= FEEDBACK_PROMPT_AFTER_LETTERS
    ? FEEDBACK_PROMPT_AFTER_LETTERS
    : count;
}
