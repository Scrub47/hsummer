import "server-only";

import {
  authorLabel,
  isBucketCategory,
  isBucketStatus,
  type BucketStatus,
} from "@/lib/bucket/fields";
import type { BucketItemView } from "@/lib/bucket/view";
import type { Session } from "@/lib/supabase/session";

export type { BucketItemView };

const STATUS_RANK: Record<BucketStatus, number> = {
  idea: 0,
  planned: 1,
  done: 2,
};

/**
 * Every item in the circle that this person is still allowed to see.
 * An error usually means the week 5 migration has not been applied.
 */
export async function loadBucketItems(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
): Promise<{ ok: true; items: BucketItemView[] } | { ok: false; items: [] }> {
  const { data, error } = await session.supabase
    .from("bucket_items")
    .select(
      "id, title, category, status, planned_date, completed_at, notes, link, created_by, created_at, updated_at",
    )
    .eq("circle_id", circleId);

  if (error) {
    console.error("Bucket list failed.", error.code);
    return { ok: false, items: [] };
  }

  const items = (data ?? [])
    .map((row) => toView(row, session.userId, names))
    .filter((item): item is BucketItemView => item !== null);

  items.sort(compareItems);
  return { ok: true, items };
}

function toView(
  row: {
    id: string;
    title: string;
    category: string;
    status: string;
    planned_date: string | null;
    completed_at: string | null;
    notes: string | null;
    link: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  },
  selfId: string,
  names: ReadonlyMap<string, string>,
): BucketItemView | null {
  if (!isBucketCategory(row.category) || !isBucketStatus(row.status)) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    plannedDate: row.planned_date,
    completedAt: row.completed_at,
    notes: row.notes,
    link: row.link,
    createdBy: row.created_by,
    author: authorLabel(row.created_by, selfId, names),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function compareItems(a: BucketItemView, b: BucketItemView): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  if (a.status === "planned") {
    const aDate = a.plannedDate ?? "9999-99-99";
    const bDate = b.plannedDate ?? "9999-99-99";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
