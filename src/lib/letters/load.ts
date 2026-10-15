import "server-only";

import { authorLabel } from "@/lib/bucket/fields";
import {
  categoryLabel,
  dearHeading,
  isLetterDesign,
} from "@/lib/letters/fields";
import type { LetterCard, LetterCategory } from "@/lib/letters/view";
import type { Session } from "@/lib/supabase/session";

export type { LetterCard, LetterCategory };

/**
 * Letters in one circle that this person may see, plus that circle's
 * custom categories. An error usually means the week 11 migration has
 * not been applied.
 */
export async function loadLetters(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
): Promise<
  | { ok: true; letters: LetterCard[]; categories: LetterCategory[] }
  | { ok: false }
> {
  const [rows, categories] = await Promise.all([
    session.supabase
      .from("letters")
      .select(
        "id, from_user_id, to_user_id, category, title, body, design, scheduled_for, status, delivered_at, opened_at, created_at",
      )
      .eq("circle_id", circleId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("letter_categories")
      .select("id, label")
      .eq("circle_id", circleId)
      .order("label", { ascending: true }),
  ]);

  if (rows.error || categories.error) {
    console.error(
      "Letters failed.",
      rows.error?.code ?? categories.error?.code,
    );
    return { ok: false };
  }

  const customLabels = (categories.data ?? [])
    .map((row) => row.label)
    .filter((label): label is string => typeof label === "string");

  const letters: LetterCard[] = [];
  for (const row of rows.data ?? []) {
    const card = toCard(session.userId, row, names, customLabels);
    if (card) letters.push(card);
  }

  return {
    ok: true,
    letters,
    categories: (categories.data ?? []).flatMap((row) =>
      typeof row.id === "string" && typeof row.label === "string"
        ? [{ id: row.id, label: row.label }]
        : [],
    ),
  };
}

function toCard(
  selfId: string,
  row: {
    id: string;
    from_user_id: string | null;
    to_user_id: string | null;
    category: string;
    title: string | null;
    body: string;
    design: string;
    scheduled_for: string | null;
    status: string;
    delivered_at: string | null;
    opened_at: string | null;
    created_at: string;
  },
  names: ReadonlyMap<string, string>,
  customLabels: readonly string[],
): LetterCard | null {
  if (!isLetterStatus(row.status) || !isLetterDesign(row.design)) return null;

  const mine = row.from_user_id === selfId;
  const sealed = !mine && row.opened_at == null && row.status === "delivered";
  const recipient = row.to_user_id
    ? (names.get(row.to_user_id) ?? "Former member")
    : "Former member";

  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id ?? "",
    category: row.category,
    categoryLabel: categoryLabel(row.category, customLabels),
    title: row.title,
    body: sealed ? null : row.body,
    design: row.design,
    status: row.status,
    scheduledFor: row.scheduled_for,
    deliveredAt: row.delivered_at,
    openedAt: row.opened_at,
    createdAt: row.created_at,
    mine,
    sealed,
    dearName: dearHeading(recipient),
    fromName: authorLabel(row.from_user_id, selfId, names),
  };
}

function isLetterStatus(value: string): value is LetterCard["status"] {
  return (
    value === "scheduled" || value === "delivered" || value === "cancelled"
  );
}
