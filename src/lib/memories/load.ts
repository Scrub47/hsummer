import "server-only";

import {
  isBoothFilter,
  isBoothLayout,
  isBoothShotPath,
  isBoothTheme,
} from "@/lib/booth/fields";
import { authorLabel, isCircleId } from "@/lib/bucket/fields";
import {
  MEMORIES_BUCKET,
  MEMORY_QUOTA_BYTES,
  MEMORY_SIGNED_URL_SECONDS,
  isDisplayableMemoryUrl,
  isMemoryPhotoPath,
  isMemoryVisibility,
} from "@/lib/memories/fields";
import type { BoothStripCard, MemoryCard } from "@/lib/memories/group";
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
    selectMemories(session, circleId),
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

  const stripIds = (rows.data ?? [])
    .map((row) =>
      row.kind === "photo-strip" &&
      typeof row.booth_session_id === "string" &&
      isCircleId(row.booth_session_id)
        ? row.booth_session_id
        : null,
    )
    .filter((id): id is string => id !== null);
  const booths = await loadBooths(session, stripIds);

  const memories: MemoryCard[] = [];
  for (const row of rows.data ?? []) {
    const card = await toCard(session, row, names, viewersByMemory, booths);
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
    letter_id?: string | null;
    checkpoint_id?: string | null;
    booth_session_id?: string | null;
  },
  names: ReadonlyMap<string, string>,
  viewersByMemory: ReadonlyMap<string, string[]>,
  booths: ReadonlyMap<string, BoothStripCard>,
): Promise<MemoryCard | null> {
  if (
    row.kind !== "photo" &&
    row.kind !== "note" &&
    row.kind !== "letter" &&
    row.kind !== "milestone" &&
    row.kind !== "photo-strip"
  ) {
    return null;
  }
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
    letterId:
      row.kind === "letter" &&
      typeof row.letter_id === "string" &&
      isCircleId(row.letter_id)
        ? row.letter_id
        : null,
    booth:
      row.kind === "photo-strip" && typeof row.booth_session_id === "string"
        ? (booths.get(row.booth_session_id) ?? null)
        : null,
  };
}

type MemoryRow = {
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
  letter_id: string | null;
  checkpoint_id: string | null;
  booth_session_id: string | null;
};

/**
 * Asks for the newest memory columns, then retries without each one that
 * the database does not have yet. The wall keeps working until that SQL
 * is applied. Rows are read as unknown so a shorter select (missing
 * letter_id, checkpoint_id, or booth_session_id) still type-checks.
 */
async function selectMemories(
  session: Session,
  circleId: string,
): Promise<{
  data: MemoryRow[] | null;
  error: { message: string; code?: string } | null;
}> {
  const columns =
    "id, created_by, kind, body, photo_path, photo_bytes, tags, visibility, occurred_on, created_at";
  const attempts = [
    `${columns}, letter_id, checkpoint_id, booth_session_id`,
    `${columns}, letter_id, checkpoint_id`,
    `${columns}, letter_id`,
    columns,
  ];

  let last = await session.supabase
    .from("memories")
    .select(attempts[0]!)
    .eq("circle_id", circleId);
  if (!last.error) return { data: asRows(last.data), error: null };

  for (const select of attempts.slice(1)) {
    const message = last.error?.message ?? "";
    const missingColumn =
      last.error?.code === "42703" ||
      /booth_session_id|checkpoint_id|letter_id/i.test(message);
    if (!missingColumn) {
      return {
        data: null,
        error: {
          message: last.error?.message ?? "Memory wall failed.",
          code: last.error?.code,
        },
      };
    }
    last = await session.supabase
      .from("memories")
      .select(select)
      .eq("circle_id", circleId);
    if (!last.error) return { data: asRows(last.data), error: null };
  }
  return {
    data: null,
    error: {
      message: last.error?.message ?? "Memory wall failed.",
      code: last.error?.code,
    },
  };
}

function asRows(data: unknown): MemoryRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string") return [];
    return [
      {
        id: record.id,
        created_by:
          typeof record.created_by === "string" ? record.created_by : null,
        kind: typeof record.kind === "string" ? record.kind : "",
        body: typeof record.body === "string" ? record.body : null,
        photo_path:
          typeof record.photo_path === "string" ? record.photo_path : null,
        photo_bytes:
          typeof record.photo_bytes === "number" ? record.photo_bytes : 0,
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        visibility:
          typeof record.visibility === "string" ? record.visibility : "",
        occurred_on:
          typeof record.occurred_on === "string" ? record.occurred_on : "",
        created_at:
          typeof record.created_at === "string" ? record.created_at : "",
        letter_id:
          typeof record.letter_id === "string" ? record.letter_id : null,
        checkpoint_id:
          typeof record.checkpoint_id === "string"
            ? record.checkpoint_id
            : null,
        booth_session_id:
          typeof record.booth_session_id === "string"
            ? record.booth_session_id
            : null,
      },
    ];
  });
}

async function loadBooths(
  session: Session,
  sessionIds: readonly string[],
): Promise<Map<string, BoothStripCard>> {
  const cards = new Map<string, BoothStripCard>();
  if (sessionIds.length === 0) return cards;

  const [sessions, contributors, shots] = await Promise.all([
    session.supabase
      .from("booth_sessions")
      .select("id, theme, frame_layout")
      .in("id", [...sessionIds]),
    session.supabase
      .from("booth_contributors")
      .select("session_id, filter_id")
      .in("session_id", [...sessionIds]),
    session.supabase
      .from("booth_shots")
      .select("session_id, position, storage_path")
      .in("session_id", [...sessionIds]),
  ]);
  if (sessions.error || contributors.error || shots.error) {
    console.error(
      "Booth strip failed.",
      sessions.error?.code ?? contributors.error?.code ?? shots.error?.code,
    );
    return cards;
  }

  const filterBySession = new Map<string, string>();
  for (const row of contributors.data ?? []) {
    if (!filterBySession.has(row.session_id)) {
      filterBySession.set(row.session_id, row.filter_id);
    }
  }

  for (const row of sessions.data ?? []) {
    if (!isBoothTheme(row.theme) || !isBoothLayout(row.frame_layout)) continue;
    const filter = filterBySession.get(row.id) ?? "none";
    if (!isBoothFilter(filter)) continue;
    const frames = (shots.data ?? [])
      .filter((shot) => shot.session_id === row.id)
      .sort((a, b) => a.position - b.position);
    const signed: { position: number; url: string }[] = [];
    for (const frame of frames) {
      const url = await signPhoto(session, frame.storage_path);
      if (url) signed.push({ position: frame.position, url });
    }
    cards.set(row.id, {
      sessionId: row.id,
      theme: row.theme,
      frameLayout: row.frame_layout,
      filterId: filter,
      shots: signed,
    });
  }
  return cards;
}

async function signPhoto(
  session: Session,
  path: string | null,
): Promise<string | null> {
  if (!path || (!isMemoryPhotoPath(path) && !isBoothShotPath(path)))
    return null;
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
