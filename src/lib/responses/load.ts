import "server-only";

import { authorLabel } from "@/lib/bucket/fields";
import { isReactionCode, type ReactionCode } from "@/lib/settings/prefs";
import type { Session } from "@/lib/supabase/session";

export type ReactionView = {
  emoji: ReactionCode;
  count: number;
  mine: boolean;
};

export type ReplyView = {
  id: string;
  body: string;
  author: string;
  mine: boolean;
};

export type ResponseView = {
  reactions: ReactionView[];
  replies: ReplyView[];
};

const empty = (): ResponseView => ({ reactions: [], replies: [] });

/**
 * Reactions and replies in one circle that this person is allowed to see.
 * Row level security hides a letter or a private memory from everyone else.
 * A missing table leaves the cards without a bar.
 */
export async function loadResponses(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
): Promise<Map<string, ResponseView>> {
  const map = new Map<string, ResponseView>();
  const [reactions, replies] = await Promise.all([
    session.supabase
      .from("reactions")
      .select("target_kind, target_id, emoji, user_id")
      .eq("circle_id", circleId),
    session.supabase
      .from("replies")
      .select("id, target_kind, target_id, body, user_id, created_at")
      .eq("circle_id", circleId)
      .order("created_at", { ascending: true }),
  ]);
  if (reactions.error || replies.error) return map;

  for (const row of reactions.data ?? []) {
    if (!isReactionCode(row.emoji)) continue;
    const key = `${row.target_kind}:${row.target_id}`;
    const view = map.get(key) ?? empty();
    const existing = view.reactions.find((item) => item.emoji === row.emoji);
    if (existing) {
      existing.count += 1;
      if (row.user_id === session.userId) existing.mine = true;
    } else {
      view.reactions.push({
        emoji: row.emoji,
        count: 1,
        mine: row.user_id === session.userId,
      });
    }
    map.set(key, view);
  }

  for (const row of replies.data ?? []) {
    const key = `${row.target_kind}:${row.target_id}`;
    const view = map.get(key) ?? empty();
    view.replies.push({
      id: row.id,
      body: row.body,
      author: authorLabel(row.user_id, session.userId, names),
      mine: row.user_id === session.userId,
    });
    map.set(key, view);
  }

  return map;
}

export function responseFor(
  map: Map<string, ResponseView> | Record<string, ResponseView>,
  kind: "letter" | "memory",
  id: string,
): ResponseView {
  if (map instanceof Map) return map.get(`${kind}:${id}`) ?? empty();
  return map[`${kind}:${id}`] ?? empty();
}
