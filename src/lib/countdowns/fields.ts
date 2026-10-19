/**
 * Still Us rules shared by the form, the server action, and the tests.
 *
 * A couple has one countdown. Checkpoints are auto-by-date or manual.
 * The database checks the same shapes and allows 10 new checkpoints per
 * 10 minutes.
 */

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";

export const COUNTDOWN_LABEL_MAX = 80;
export const CHECKPOINT_LABEL_MAX = 80;
export const CHECKPOINT_LIMIT = 10;
export const CHECKPOINT_WINDOW_MINUTES = 10;
export const DEFAULT_COUNTDOWN_LABEL = "Still Us";

export const COUNTDOWN_UNAVAILABLE =
  "Still Us isn't available yet. Apply the week 12 SQL in the Supabase SQL editor, then try again.";

export const COUNTDOWN_DATE_ERROR = "Pick a real date.";
export const COUNTDOWN_LABEL_ERROR =
  "Use a name up to 80 characters, without an @.";
export const CHECKPOINT_TRIGGER_ERROR = "Choose how this checkpoint is hit.";

export const CHECKPOINT_RATE_LIMIT_MESSAGE =
  "You've added a few checkpoints just now. Wait a little and try again.";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LABEL_PATTERN = /^[^\u0000-\u001F\u007F@]+$/;

const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(COUNTDOWN_LABEL_MAX)
  .refine((value) => LABEL_PATTERN.test(value) && !value.includes("@"));

const dateSchema = z
  .string()
  .regex(DATE_PATTERN)
  .refine((value) => {
    const match = DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2100 || month < 1 || month > 12) return false;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  });

const triggerSchema = z.enum(["auto-by-date", "manual"]);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type CheckpointTrigger = z.infer<typeof triggerSchema>;

export { isCircleId };

export function parseCountdownDraft(input: {
  label: unknown;
  targetDate: unknown;
}): Parsed<{ label: string; targetDate: string }> {
  const label = parseLabel(input.label, DEFAULT_COUNTDOWN_LABEL);
  if (!label.ok) return label;
  const targetDate = dateSchema.safeParse(
    typeof input.targetDate === "string" ? input.targetDate.trim() : "",
  );
  if (!targetDate.success) return { ok: false, error: COUNTDOWN_DATE_ERROR };
  return {
    ok: true,
    value: { label: label.value, targetDate: targetDate.data },
  };
}

export function parseCheckpointDraft(input: {
  label: unknown;
  date: unknown;
  trigger: unknown;
}): Parsed<{ label: string; date: string; trigger: CheckpointTrigger }> {
  const label = parseLabel(input.label, null);
  if (!label.ok) return label;
  const date = dateSchema.safeParse(
    typeof input.date === "string" ? input.date.trim() : "",
  );
  if (!date.success) return { ok: false, error: COUNTDOWN_DATE_ERROR };
  const trigger = triggerSchema.safeParse(input.trigger);
  if (!trigger.success) {
    return { ok: false, error: CHECKPOINT_TRIGGER_ERROR };
  }
  return {
    ok: true,
    value: { label: label.value, date: date.data, trigger: trigger.data },
  };
}

export function countdownWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  const demo = demoWriteMessage(message);
  if (demo) return demo;
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST202" ||
    (message?.includes("countdowns") && message.includes("schema")) ||
    (message?.includes("checkpoints") && message.includes("schema")) ||
    message?.includes("sync_auto_checkpoints") ||
    message?.includes("hit_checkpoint")
  ) {
    return COUNTDOWN_UNAVAILABLE;
  }
  if (message?.includes("hsummer_rate_limited")) {
    return CHECKPOINT_RATE_LIMIT_MESSAGE;
  }
  if (message?.includes("hsummer_countdown_couple")) {
    return "A couple keeps one countdown. Change the date instead.";
  }
  if (
    message?.includes("hsummer_checkpoint_locked") ||
    message?.includes("hsummer_checkpoint_hit") ||
    message?.includes("hsummer_countdown_locked")
  ) {
    return "That checkpoint can't be changed.";
  }
  if (
    message?.includes("countdowns_target_sane") ||
    message?.includes("checkpoints_date_sane") ||
    message?.includes("countdowns_label_shape") ||
    message?.includes("checkpoints_label_shape") ||
    message?.includes("checkpoints_trigger_known")
  ) {
    return "That isn't a date this countdown can use.";
  }
  if (
    message?.includes("row-level security") ||
    message?.includes("42501") ||
    code === "42501"
  ) {
    return "You can't change that.";
  }
  return null;
}

function parseLabel(value: unknown, fallback: string | null): Parsed<string> {
  if (typeof value !== "string") {
    if (fallback && (value == null || value === "")) {
      return { ok: true, value: fallback };
    }
    return { ok: false, error: COUNTDOWN_LABEL_ERROR };
  }
  const label = value.trim().replace(/\s+/g, " ");
  if (!label && fallback) return { ok: true, value: fallback };
  const parsed = labelSchema.safeParse(label);
  if (!parsed.success) return { ok: false, error: COUNTDOWN_LABEL_ERROR };
  return { ok: true, value: parsed.data };
}
