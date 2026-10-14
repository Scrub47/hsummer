import "server-only";

import type { CheckpointTrigger } from "@/lib/countdowns/fields";
import { daysLabel, daysUntil, formatCalendarDate } from "@/lib/schedule/time";
import type { Session } from "@/lib/supabase/session";

export type CountdownCard = {
  id: string;
  label: string;
  targetDate: string | null;
  days: number | null;
  daysText: string | null;
  targetLabel: string | null;
};

export type CheckpointCard = {
  id: string;
  countdownId: string;
  label: string;
  date: string;
  dateLabel: string;
  trigger: CheckpointTrigger;
  hitAt: string | null;
};

/**
 * The circle's countdowns and checkpoints. An error usually means the
 * week 12 migration has not been applied.
 */
export async function loadStillUs(
  session: Session,
  circleId: string,
  timeZone: string,
): Promise<
  | { ok: true; countdowns: CountdownCard[]; checkpoints: CheckpointCard[] }
  | { ok: false }
> {
  const [countdowns, checkpoints] = await Promise.all([
    session.supabase
      .from("countdowns")
      .select("id, label, target_date, created_at")
      .eq("circle_id", circleId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("checkpoints")
      .select("id, countdown_id, label, date, trigger, hit_at")
      .eq("circle_id", circleId)
      .order("date", { ascending: true }),
  ]);

  if (countdowns.error || checkpoints.error) {
    console.error(
      "Still Us failed.",
      countdowns.error?.code ?? checkpoints.error?.code,
    );
    return { ok: false };
  }

  return {
    ok: true,
    countdowns: (countdowns.data ?? []).flatMap((row) => {
      const card = toCountdown(row, timeZone);
      return card ? [card] : [];
    }),
    checkpoints: (checkpoints.data ?? []).flatMap((row) => {
      const card = toCheckpoint(row);
      return card ? [card] : [];
    }),
  };
}

function toCountdown(
  row: {
    id: string;
    label: string;
    target_date: string | null;
  },
  timeZone: string,
): CountdownCard | null {
  if (!row.id || !row.label) return null;
  const targetDate = row.target_date;
  const days = targetDate == null ? null : daysUntil(targetDate, timeZone);
  return {
    id: row.id,
    label: row.label,
    targetDate,
    days,
    daysText: days == null ? null : daysLabel(days),
    targetLabel: targetDate ? formatCalendarDate(targetDate) : null,
  };
}

function toCheckpoint(row: {
  id: string;
  countdown_id: string;
  label: string;
  date: string;
  trigger: string;
  hit_at: string | null;
}): CheckpointCard | null {
  if (row.trigger !== "auto-by-date" && row.trigger !== "manual") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  return {
    id: row.id,
    countdownId: row.countdown_id,
    label: row.label,
    date: row.date,
    dateLabel: formatCalendarDate(row.date),
    trigger: row.trigger,
    hitAt: row.hit_at,
  };
}
