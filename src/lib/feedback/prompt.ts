/**
 * When the gentle check-in may appear. Seven days since the account was
 * created, or ten letters that were not cancelled. A dismissal, or the
 * demo account, keeps it hidden.
 */

export const FEEDBACK_PROMPT_AFTER_DAYS = 7;
export const FEEDBACK_PROMPT_AFTER_LETTERS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export function feedbackPromptEligible(input: {
  dismissed: boolean;
  demo: boolean;
  accountCreatedAt: string | null;
  lettersSent: number;
  now: Date;
}): boolean {
  if (input.dismissed || input.demo) return false;
  if (input.lettersSent >= FEEDBACK_PROMPT_AFTER_LETTERS) return true;
  if (!input.accountCreatedAt) return false;
  const created = Date.parse(input.accountCreatedAt);
  if (!Number.isFinite(created)) return false;
  return input.now.getTime() - created >= FEEDBACK_PROMPT_AFTER_DAYS * DAY_MS;
}
