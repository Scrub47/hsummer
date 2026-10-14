import "server-only";

import { authorLabel } from "@/lib/bucket/fields";
import {
  MEMORIES_BUCKET,
  MEMORY_QUOTA_BYTES,
  MEMORY_SIGNED_URL_SECONDS,
  isDisplayableMemoryUrl,
  isMemoryPhotoPath,
  isMemoryVisibility,
} from "@/lib/memories/fields";
import type { MemoryCard } from "@/lib/memories/group";
import type { Session } from "@/lib/supabase/session";

export type MemoryWall = {
  memories: MemoryCard[];
  usedBytes: number;
  quotaBytes: number;
};

/**
 * Memories in one circle that this person is still allowed to see, plus the
 * circle's photo usage. An error usually means the week 8 migration has not
 * been applied.
 *
 * Photo bytes stay in the private bucket. Each photo URL is signed by this
 * server for MEMORY_SIGNED_URL_SECONDS. Storage stops accepting the link
 * after that.
 */
export async function loadMemories(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
): Promise<{ ok: true; wall: MemoryWall } | { ok: false; wall: null }> {
  const [rows, viewers, usage] = await Promise.all([
    session.supabase
      .from("memories")
      .select(
        "id, created_by, kind, body, photo_path, photo_bytes, tags, visibility, occurred_on, created_at",
      )
      .eq("circle_id", circleId),
    session.supabase
      .from("memory_viewers")
      .select("memory_id, user_id")
      .eq("circle_id", circleId),
    session.supabase.rpc("circle_memory_bytes", { target: circleId }),
  ]);

  if (rows.error || viewers.error) {
    console.error(
      "Memory wall failed.",
      rows.error?.code ?? viewers.error?.code,
    );
    return { ok: false, wall: null };
  }

  const viewersByMemory = new Map<string, string[]>();
  for (const viewer of viewers.data ?? []) {
    const list = viewersByMemory.get(viewer.memory_id) ?? [];
    list.push(viewer.user_id);
    viewersByMemory.set(viewer.memory_id, list);
  }

  const memories: MemoryCard[] = [];
  for (const row of rows.data ?? []) {
    const card = await toCard(session, row, names, viewersByMemory);
    if (card) memories.push(card);
  }

  return {
    ok: true,
    wall: {
      memories,
      usedBytes: usageNumber(usage.data),
      quotaBytes: MEMORY_QUOTA_BYTES,
    },
  };
}

async function toCard(
  session: Session,
  row: {
    id: string;
    created_by: string | null;
    kind: string;
    body: string | null;
    photo_path: string | null;
    photo_bytes: number;
    tags: string[];
    visibility: string;
    occurred_on: string;
    created_at: string;
  },
  names: ReadonlyMap<string, string>,
  viewersByMemory: ReadonlyMap<string, string[]>,
): Promise<MemoryCard | null> {
  if (row.kind !== "photo" && row.kind !== "note") return null;
  if (!isMemoryVisibility(row.visibility)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on)) return null;

  const mine = row.created_by === session.userId;
  const viewerIds = viewersByMemory.get(row.id) ?? [];
  const photoUrl =
    row.kind === "photo" ? await signPhoto(session, row.photo_path) : null;

  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    photoUrl,
    photoPath: row.kind === "photo" ? row.photo_path : null,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag) => typeof tag === "string")
      : [],
    visibility: row.visibility,
    viewerNames: mine
      ? viewerIds.map((id) => names.get(id) ?? "Former member")
      : [],
    occurredOn: row.occurred_on,
    createdAt: row.created_at,
    author: authorLabel(row.created_by, session.userId, names),
    mine,
  };
}

async function signPhoto(
  session: Session,
  path: string | null,
): Promise<string | null> {
  if (!path || !isMemoryPhotoPath(path)) return null;
  const { data, error } = await session.supabase.storage
    .from(MEMORIES_BUCKET)
    .createSignedUrl(path, MEMORY_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl || !isDisplayableMemoryUrl(data.signedUrl)) {
    return null;
  }
  return data.signedUrl;
}

function usageNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return 0;
}
