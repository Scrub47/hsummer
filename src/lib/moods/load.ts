import "server-only";

import { isMoodEmoji, moodLabel } from "@/lib/moods/fields";
import type { Session } from "@/lib/supabase/session";

export type CurrentMood = {
  userId: string;
  emoji: string;
  label: string;
  updatedAt: string;
  when: string;
};

/**
 * Moods in one circle that this person is still allowed to see.
 * An error usually means the week 7 migration has not been applied.
 * An emoji outside the palette is dropped.
 */
export async function loadCurrentMoods(
  session: Session,
  circleId: string,
  timeZone: string,
): Promise<{ ok: true; moods: CurrentMood[] } | { ok: false; moods: [] }> {
  const { data, error } = await session.supabase
    .from("current_moods")
    .select("user_id, emoji, updated_at")
    .eq("circle_id", circleId);

  if (error) {
    console.error("Mood list failed.", error.code);
    return { ok: false, moods: [] };
  }

  const moods = (data ?? [])
    .map((row) => toMood(row, timeZone))
    .filter((mood): mood is CurrentMood => mood !== null);

  moods.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { ok: true, moods };
}

function toMood(
  row: { user_id: string; emoji: string; updated_at: string },
  timeZone: string,
): CurrentMood | null {
  const label = moodLabel(row.emoji);
  if (!isMoodEmoji(row.emoji) || !label) return null;
  return {
    userId: row.user_id,
    emoji: row.emoji,
    label,
    updatedAt: row.updated_at,
    when: formatWhen(row.updated_at, timeZone),
  };
}

function formatWhen(updatedAt: string, timeZone: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }
}
