import "server-only";

import { authorLabel } from "@/lib/bucket/fields";
import {
  isBoothLayout,
  isBoothShotPath,
  isBoothTheme,
  shotCount,
  type PassTurn,
} from "@/lib/booth/fields";
import {
  MEMORIES_BUCKET,
  MEMORY_SIGNED_URL_SECONDS,
  isDisplayableMemoryUrl,
} from "@/lib/memories/fields";
import type { Session } from "@/lib/supabase/session";

export type PassBoard = {
  ok: true;
  turns: PassTurn[];
};

/**
 * Open, cancelled, and expired passes this person is allowed to see.
 * Calls expire first so a booth past 7 days closes before the page draws it.
 * A missing week 15 function leaves the board empty and Solo still works.
 */
export async function loadPassBooth(
  session: Session,
  circleId: string,
  names: ReadonlyMap<string, string>,
  timeZone: string,
): Promise<PassBoard | { ok: false }> {
  const expired = await session.supabase.rpc("expire_pass_booths", {
    target_circle: circleId,
  });
  if (
    expired.error &&
    !isMissingPass(expired.error.message, expired.error.code)
  ) {
    console.error("Pass expiry failed.", expired.error.code);
  }

  const sessions = await session.supabase
    .from("booth_sessions")
    .select(
      "id, theme, frame_layout, status, expires_at, created_by, caption, mode, created_at",
    )
    .eq("circle_id", circleId)
    .eq("mode", "pass")
    .in("status", ["open", "expired", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(8);

  if (sessions.error) {
    if (isMissingPass(sessions.error.message, sessions.error.code)) {
      return { ok: false };
    }
    console.error("Pass list failed.", sessions.error.code);
    return { ok: false };
  }

  const ids = (sessions.data ?? []).map((row) => row.id);
  if (ids.length === 0) return { ok: true, turns: [] };

  const [contributors, shots] = await Promise.all([
    session.supabase
      .from("booth_contributors")
      .select("session_id, user_id, assigned_positions, filter_id")
      .in("session_id", ids),
    session.supabase
      .from("booth_shots")
      .select("session_id, position, storage_path")
      .in("session_id", ids),
  ]);
  if (contributors.error || shots.error) {
    console.error(
      "Pass frames failed.",
      contributors.error?.code ?? shots.error?.code,
    );
    return { ok: false };
  }

  const turns: PassTurn[] = [];
  for (const row of sessions.data ?? []) {
    if (!isBoothTheme(row.theme) || !isBoothLayout(row.frame_layout)) continue;
    if (
      row.status !== "open" &&
      row.status !== "expired" &&
      row.status !== "cancelled"
    ) {
      continue;
    }
    const people = (contributors.data ?? []).filter(
      (contributor) => contributor.session_id === row.id,
    );
    const mine = people.find((person) => person.user_id === session.userId);
    const positions = sortedPositions(mine?.assigned_positions);
    if (!mine || positions.length === 0) continue;
    const partner = people.find((person) => person.user_id !== session.userId);
    const filled = new Set(
      (shots.data ?? [])
        .filter((shot) => shot.session_id === row.id)
        .map((shot) => shot.position),
    );
    const shotByPosition = new Map(
      (shots.data ?? [])
        .filter((shot) => shot.session_id === row.id)
        .map((shot) => [shot.position, shot] as const),
    );
    const frames = await Promise.all(
      Array.from({ length: shotCount(row.frame_layout) }, async (_, position) => {
        const shot = shotByPosition.get(position);
        const url =
          shot && isBoothShotPath(shot.storage_path)
            ? await signFrame(session, shot.storage_path)
            : null;
        return { position, url };
      }),
    );
    turns.push({
      sessionId: row.id,
      theme: row.theme,
      layout: row.frame_layout,
      status: row.status,
      expiresLabel: expiresLabel(row.expires_at, timeZone),
      startedByMe: row.created_by === session.userId,
      partnerName: authorLabel(partner?.user_id ?? null, session.userId, names),
      myPositions: positions,
      frames,
      caption: row.caption,
      waitingOnYou:
        row.status === "open" &&
        positions.some((position) => !filled.has(position)),
    });
  }

  turns.sort((a, b) => Number(b.waitingOnYou) - Number(a.waitingOnYou));
  return { ok: true, turns };
}

function sortedPositions(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((position): position is number => Number.isInteger(position))
    .sort((a, b) => a - b);
}

function expiresLabel(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
}

async function signFrame(
  session: Session,
  path: string,
): Promise<string | null> {
  const { data, error } = await session.supabase.storage
    .from(MEMORIES_BUCKET)
    .createSignedUrl(path, MEMORY_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl || !isDisplayableMemoryUrl(data.signedUrl)) {
    return null;
  }
  return data.signedUrl;
}

function isMissingPass(message: string | undefined, code: string | undefined) {
  if (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "42P01"
  ) {
    return true;
  }
  return Boolean(
    message?.includes("expire_pass_booths") ||
    message?.includes("caption") ||
    message?.includes("booth_sessions"),
  );
}
