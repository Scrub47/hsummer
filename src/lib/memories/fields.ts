/**
 * Memory wall rules shared by the form, the server action, and the tests.
 *
 * The database checks the same shapes. A photo is a JPEG, PNG, or WebP up to
 * 2 MB. A circle holds 100 MB of those bytes. Notes do not count. Inserts are
 * capped at 10 per person per 10 minutes, in Postgres and, when configured,
 * in Upstash first.
 */

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";

export const MEMORIES_BUCKET = "memories";

/** Stored object cap. Matches the bucket file_size_limit. */
export const MEMORY_MAX_BYTES = 2 * 1024 * 1024;

/** Sum of photo_bytes per circle. 100 MB. */
export const MEMORY_QUOTA_BYTES = 100 * 1024 * 1024;

/**
 * How long a server-issued photo link lasts. Storage rejects the link after
 * this. The page asks for this value and no longer.
 */
export const MEMORY_SIGNED_URL_SECONDS = 5 * 60;

/** Successful inserts inside the window. The 11th is refused. */
export const MEMORY_LIMIT = 10;
export const MEMORY_WINDOW_MINUTES = 10;

export const MEMORY_NOTE_MAX = 2000;
export const MEMORY_CAPTION_MAX = 280;
export const MEMORY_TAG_MAX = 8;
export const MEMORY_TAG_LENGTH = 24;

export const MEMORY_RATE_LIMIT_MESSAGE =
  "You've added a few memories just now. Wait a little and try again.";

export const MEMORY_QUOTA_MESSAGE =
  "This circle is out of photo space. Delete a photo to add another.";

export const MEMORY_UNAVAILABLE =
  "The memory wall isn't available yet. Apply the week 8 SQL in the Supabase SQL editor, then try again.";

export const PHOTO_ERROR = "Use a JPEG, PNG, or WebP image up to 2 MB.";
export const NOTE_ERROR =
  "Write a note up to 2,000 characters, or add a photo.";
export const CAPTION_ERROR = "Keep the caption under 280 characters.";
export const TAG_ERROR =
  "Use up to 8 tags. Each tag is up to 24 letters, numbers, spaces, or hyphens.";
export const DATE_ERROR = "Use a real date, not in the future.";
export const VISIBILITY_ERROR = "Choose who can see this.";

export const MEMORY_VISIBILITIES = ["circle", "selected"] as const;

export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];
export type MemoryKind = "photo" | "note";

export type MemoryPhoto = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export type MemoryDraft = {
  kind: MemoryKind;
  body: string | null;
  photo: MemoryPhoto | null;
  tags: string[];
  visibility: MemoryVisibility;
  viewerIds: string[];
  occurredOn: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]{0,23}$/;
const PHOTO_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export { isCircleId };

export function isMemoryVisibility(value: string): value is MemoryVisibility {
  return value === "circle" || value === "selected";
}

export function memoryPhotoPath(
  circleId: string,
  memoryId: string,
  extension: MemoryPhoto["extension"],
): string {
  return `${circleId}/${memoryId}.${extension}`;
}

export function isMemoryPhotoPath(path: string): boolean {
  return PHOTO_PATH_PATTERN.test(path);
}

/** https or http URLs with no credentials. Rejects javascript: and similar. */
export function isDisplayableMemoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseTags(value: unknown): Parsed<string[]> {
  if (value == null) return { ok: true, value: [] };
  if (typeof value !== "string") return { ok: false, error: TAG_ERROR };
  const tags = [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  ];
  if (tags.length > MEMORY_TAG_MAX) return { ok: false, error: TAG_ERROR };
  if (tags.some((tag) => !TAG_PATTERN.test(tag))) {
    return { ok: false, error: TAG_ERROR };
  }
  return { ok: true, value: tags };
}

const memoryVisibilitySchema = z.enum(["circle", "selected"]);

export function parseMemoryForm(input: {
  body: unknown;
  tags: unknown;
  occurredOn: unknown;
  visibility: unknown;
  viewerIds: readonly string[];
  photo: Uint8Array | null;
  now?: Date;
}): Parsed<Omit<MemoryDraft, "photo"> & { photo: Uint8Array | null }> {
  const tags = parseTags(input.tags);
  if (!tags.ok) return tags;
  const occurredOn = parseOccurredOn(input.occurredOn, input.now);
  if (!occurredOn.ok) return occurredOn;

  const visibility = memoryVisibilitySchema.safeParse(input.visibility);
  if (!visibility.success) {
    return { ok: false, error: VISIBILITY_ERROR };
  }

  const viewerIds = [
    ...new Set(
      input.viewerIds.filter((id) => typeof id === "string" && isCircleId(id)),
    ),
  ];
  if (viewerIds.length > 30) {
    return { ok: false, error: "Pick people who are still in this circle." };
  }

  const text =
    typeof input.body === "string" && input.body.trim().length > 0
      ? input.body.trim()
      : null;

  if (!input.photo) {
    if (!text || [...text].length > MEMORY_NOTE_MAX) {
      return { ok: false, error: NOTE_ERROR };
    }
    return {
      ok: true,
      value: {
        kind: "note",
        body: text,
        photo: null,
        tags: tags.value,
        visibility: visibility.data,
        viewerIds: visibility.data === "selected" ? viewerIds : [],
        occurredOn: occurredOn.value,
      },
    };
  }

  if (text && [...text].length > MEMORY_CAPTION_MAX) {
    return { ok: false, error: CAPTION_ERROR };
  }

  return {
    ok: true,
    value: {
      kind: "photo",
      body: text,
      photo: input.photo,
      tags: tags.value,
      visibility: visibility.data,
      viewerIds: visibility.data === "selected" ? viewerIds : [],
      occurredOn: occurredOn.value,
    },
  };
}

export function parseOccurredOn(
  value: unknown,
  now = new Date(),
): Parsed<string> {
  if (typeof value !== "string") return { ok: false, error: DATE_ERROR };
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return { ok: false, error: DATE_ERROR };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day ||
    year < 1900
  ) {
    return { ok: false, error: DATE_ERROR };
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const latest = today + 24 * 60 * 60 * 1000;
  if (utc.getTime() > latest) return { ok: false, error: DATE_ERROR };
  return { ok: true, value: value.trim() };
}

/**
 * Calendar date in a time zone, as YYYY-MM-DD. A bad zone falls back to UTC.
 * The wall files a memory under this date unless the form sends another one.
 */
export function calendarDate(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return DATE_PATTERN.test(parts) ? parts : calendarDate("UTC", now);
  } catch {
    if (timeZone === "UTC") {
      return now.toISOString().slice(0, 10);
    }
    return calendarDate("UTC", now);
  }
}

export function formatMemoryUsage(used: number, quota: number): string {
  return `${formatMegabytes(used)} of ${formatMegabytes(quota)} used for photos`;
}

export function formatMonth(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Maps a Postgres error from a memory write onto a sentence, or null. */
export function memoryWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  const demo = demoWriteMessage(message);
  if (demo) return demo;
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    (message?.includes("memories") && message.includes("schema")) ||
    (message?.includes("memory_viewers") && message.includes("schema"))
  ) {
    return MEMORY_UNAVAILABLE;
  }
  if (message?.includes("hsummer_rate_limited")) {
    return MEMORY_RATE_LIMIT_MESSAGE;
  }
  if (message?.includes("hsummer_storage_quota")) {
    return MEMORY_QUOTA_MESSAGE;
  }
  if (
    message?.includes("memories_photo_shape") ||
    message?.includes("memories_body_shape") ||
    message?.includes("memories_tags_ok") ||
    message?.includes("memories_occurred_on_sane") ||
    message?.includes("memories_kind_known") ||
    message?.includes("memories_visibility_known") ||
    message?.includes("hsummer_memory_path") ||
    message?.includes("hsummer_memory_locked")
  ) {
    return "That memory isn't valid.";
  }
  if (
    message?.includes("hsummer_memory_viewer") ||
    message?.includes("hsummer_memory_visibility") ||
    message?.includes("hsummer_memory_circle")
  ) {
    return "Pick people who are still in this circle.";
  }
  if (
    message?.includes("row-level security") ||
    message?.includes("42501") ||
    code === "42501"
  ) {
    return "You can't change that memory.";
  }
  return null;
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (!Number.isFinite(mb) || mb < 0) return "0 MB";
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}
