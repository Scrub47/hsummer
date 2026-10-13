import "server-only";

import { pingPhrase } from "@/lib/pings/fields";
import type { Session } from "@/lib/supabase/session";

export type PingListItem = {
  id: string;
  fromUserId: string | null;
  fromName: string;
  phrase: string;
  sentAt: string;
  when: string;
};

/**
 * Recent gestures in one circle. RLS already hides rows this person is not a
 * party to, including a 1:1 ping between two other members.
 */
export async function loadRecentPings(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
  timeZone: string,
): Promise<PingListItem[]> {
  const { data, error } = await session.supabase
    .from("pings")
    .select(
      "id, from_user_id, to_user_id, ping_type, mood_emoji, secret_variant, sent_at",
    )
    .eq("circle_id", circleId)
    .order("sent_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Ping list failed.", error.code);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    fromUserId: row.from_user_id,
    fromName: senderName(row.from_user_id, names),
    phrase: phraseFor(row, names),
    sentAt: row.sent_at,
    when: formatWhen(row.sent_at, timeZone),
  }));
}

function senderName(
  fromUserId: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (!fromUserId) return "Former member";
  return names.get(fromUserId) ?? "Former member";
}

function phraseFor(
  row: {
    ping_type: string;
    mood_emoji: string | null;
    secret_variant: boolean;
    to_user_id: string | null;
  },
  names: ReadonlyMap<string, string>,
): string {
  if (row.ping_type === "mood-share" && row.mood_emoji) return row.mood_emoji;
  const recipient = row.to_user_id
    ? (names.get(row.to_user_id) ?? "them")
    : "them";
  return pingPhrase(row.secret_variant, recipient);
}

function formatWhen(sentAt: string, timeZone: string): string {
  const date = new Date(sentAt);
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
