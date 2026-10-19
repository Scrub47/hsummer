import "server-only";

import { isBoothShotPath } from "@/lib/booth/fields";
import { thinkingOfYouStillVisible } from "@/lib/pings/fields";
import { isMemoryPhotoPath, MEMORIES_BUCKET } from "@/lib/memories/fields";
import type { Session } from "@/lib/supabase/session";

import { zipStore } from "@/lib/export/zip";

const MAX_FILES = 400;
const MAX_BYTES = 80 * 1024 * 1024;

/**
 * A personal ZIP of what this signed-in person can already read.
 * Row Level Security does the filtering, so another person's letter or a
 * selected memory they were not given is not in the file. Push keys and
 * emails are left out. Image bytes are the files themselves, not signed links.
 */
export async function buildExportZip(session: Session): Promise<Uint8Array> {
  const userId = session.userId;
  const profile = await session.supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", userId)
    .maybeSingle();

  const memberships = await session.supabase
    .from("circle_members")
    .select("circle_id, joined_at, left_at")
    .eq("user_id", userId);

  const circleIds = (memberships.data ?? []).map((row) => row.circle_id);

  const [
    circles,
    members,
    letters,
    memories,
    bucket,
    countdowns,
    checkpoints,
    moods,
    pings,
    sessions,
    shots,
  ] =
    circleIds.length === 0
      ? await emptyRelations()
      : await Promise.all([
          session.supabase
            .from("circles")
            .select("id, name, circle_type, status, created_at")
            .in("id", circleIds),
          session.supabase
            .from("circle_members")
            .select("circle_id, user_id, joined_at, left_at")
            .in("circle_id", circleIds),
          session.supabase
            .from("letters")
            .select(
              "id, circle_id, from_user_id, to_user_id, category, title, body, design, status, scheduled_for, delivered_at, opened_at, created_at",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("memories")
            .select(
              "id, circle_id, created_by, kind, body, photo_path, tags, visibility, occurred_on, created_at, letter_id, checkpoint_id, booth_session_id",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("bucket_items")
            .select(
              "id, circle_id, created_by, title, category, status, planned_date, notes, link, completed_at",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("countdowns")
            .select("id, circle_id, label, target_date, created_by, created_at")
            .in("circle_id", circleIds),
          session.supabase
            .from("checkpoints")
            .select(
              "id, circle_id, countdown_id, label, date, trigger, hit_at, created_by",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("current_moods")
            .select("user_id, circle_id, emoji, updated_at")
            .in("circle_id", circleIds),
          session.supabase
            .from("pings")
            .select(
              "id, circle_id, from_user_id, to_user_id, ping_type, mood_emoji, sent_at",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("booth_sessions")
            .select(
              "id, circle_id, created_by, mode, theme, frame_layout, status, created_at",
            )
            .in("circle_id", circleIds),
          session.supabase
            .from("booth_shots")
            .select("session_id, user_id, position, storage_path"),
        ]);

  const peopleIds = new Set<string>();
  for (const member of members.data ?? []) peopleIds.add(member.user_id);
  const people =
    peopleIds.size === 0
      ? { data: [] as { id: string; display_name: string }[] }
      : await session.supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", [...peopleIds]);

  const names = Object.fromEntries(
    (people.data ?? []).map((person) => [person.id, person.display_name]),
  );

  const sessionIds = new Set((sessions.data ?? []).map((row) => row.id));
  const visibleShots = (shots.data ?? []).filter((shot) =>
    sessionIds.has(shot.session_id),
  );

  const paths = new Set<string>();
  for (const memory of memories.data ?? []) {
    if (memory.photo_path && isMemoryPhotoPath(memory.photo_path)) {
      paths.add(memory.photo_path);
    }
  }
  for (const shot of visibleShots) {
    if (isBoothShotPath(shot.storage_path)) paths.add(shot.storage_path);
  }

  const files: { name: string; data: Uint8Array }[] = [];
  const missing: string[] = [];
  let used = 0;
  let truncated = false;

  for (const path of paths) {
    if (files.length >= MAX_FILES || used >= MAX_BYTES) {
      truncated = true;
      missing.push(path);
      continue;
    }
    const downloaded = await session.supabase.storage
      .from(MEMORIES_BUCKET)
      .download(path);
    if (downloaded.error || !downloaded.data) {
      missing.push(path);
      continue;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (used + bytes.byteLength > MAX_BYTES) {
      truncated = true;
      missing.push(path);
      continue;
    }
    used += bytes.byteLength;
    files.push({ name: `files/${path}`, data: bytes });
  }

  const document = {
    exportedAt: new Date().toISOString(),
    note: "Personal download of what you can see. Image files are in files/. This is not a backup of the whole database, and it does not include anyone else's private letters.",
    truncated,
    missingFiles: missing,
    profile: profile.data
      ? {
          displayName: profile.data.display_name,
          timezone: profile.data.timezone,
        }
      : null,
    people: names,
    circles: circles.data ?? [],
    members: members.data ?? [],
    letters: letters.data ?? [],
    memories: memories.data ?? [],
    bucketItems: bucket.data ?? [],
    countdowns: countdowns.data ?? [],
    checkpoints: checkpoints.data ?? [],
    moods: moods.data ?? [],
    pings: (pings.data ?? []).filter((row) =>
      thinkingOfYouStillVisible(row.ping_type, row.sent_at),
    ),
    boothSessions: sessions.data ?? [],
    boothShots: visibleShots,
  };

  const json = new TextEncoder().encode(JSON.stringify(document, null, 2));
  return zipStore([{ name: "export.json", data: json }, ...files]);
}

function emptyRelations() {
  const empty = Promise.resolve({ data: [], error: null });
  return Promise.all([
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
    empty,
  ]) as Promise<
    [
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
      { data: never[] },
    ]
  >;
}
