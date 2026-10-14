/**
 * Bucket list rules shared by the server actions, the form, and the tests.
 *
 * The database checks the same shapes. Categories and statuses match the
 * plan: restaurants, movies, activities, date ideas, and distance-specific
 * ideas; idea, then planned, then done.
 */

import { z } from "zod";

export const BUCKET_CATEGORIES = [
  { value: "restaurant", label: "Restaurants" },
  { value: "movie", label: "Movies" },
  { value: "activity", label: "Activities" },
  { value: "date-idea", label: "Date ideas" },
  { value: "ldr-idea", label: "Distance-specific ideas" },
] as const;

export const BUCKET_STATUSES = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "done", label: "Done" },
] as const;

export type BucketCategory = (typeof BUCKET_CATEGORIES)[number]["value"];
export type BucketStatus = (typeof BUCKET_STATUSES)[number]["value"];

export const BUCKET_TITLE_MAX = 120;
export const BUCKET_NOTES_MAX = 2000;
export const BUCKET_LINK_MAX = 500;

const CIRCLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const TITLE_ERROR = "Use a title up to 120 characters.";
export const CATEGORY_ERROR = "Pick a category.";
export const STATUS_ERROR = "Pick idea, planned, or done.";
export const DATE_ERROR = "Use a real date, or leave the planned date empty.";
export const LINK_ERROR = "Links need to start with http:// or https://.";
export const NOTES_ERROR = "Keep the note under 2,000 characters.";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type BucketDraft = {
  title: string;
  category: BucketCategory;
  status: BucketStatus;
  plannedDate: string | null;
  notes: string | null;
  link: string | null;
};

export function isBucketCategory(value: string): value is BucketCategory {
  return BUCKET_CATEGORIES.some((category) => category.value === value);
}

export function isBucketStatus(value: string): value is BucketStatus {
  return BUCKET_STATUSES.some((status) => status.value === value);
}

export function categoryLabel(value: BucketCategory): string {
  return (
    BUCKET_CATEGORIES.find((category) => category.value === value)?.label ??
    value
  );
}

export function statusLabel(value: BucketStatus): string {
  return (
    BUCKET_STATUSES.find((status) => status.value === value)?.label ?? value
  );
}

export function isCircleId(value: string): boolean {
  return CIRCLE_ID_PATTERN.test(value);
}

export function parseBucketTitle(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { ok: false, error: TITLE_ERROR };
  const title = value.trim();
  if (title.length === 0 || [...title].length > BUCKET_TITLE_MAX) {
    return { ok: false, error: TITLE_ERROR };
  }
  return { ok: true, value: title };
}

export function parseBucketNotes(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: NOTES_ERROR };
  const notes = value.trim();
  if (notes.length === 0) return { ok: true, value: null };
  if ([...notes].length > BUCKET_NOTES_MAX) {
    return { ok: false, error: NOTES_ERROR };
  }
  return { ok: true, value: notes };
}

/** Calendar date `YYYY-MM-DD`, or empty. Invalid dates such as month 13 fail. */
export function parsePlannedDate(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: DATE_ERROR };
  const date = value.trim();
  if (date.length === 0) return { ok: true, value: null };
  const match = DATE_PATTERN.exec(date);
  if (!match) return { ok: false, error: DATE_ERROR };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return { ok: false, error: DATE_ERROR };
  }
  return { ok: true, value: date };
}

export function parseBucketLink(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  const parsed = z.string().safeParse(value);
  if (!parsed.success) return { ok: false, error: LINK_ERROR };
  const link = parsed.data.trim();
  if (link.length === 0) return { ok: true, value: null };
  if (link.length > BUCKET_LINK_MAX || /\s/.test(link)) {
    return { ok: false, error: LINK_ERROR };
  }
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: LINK_ERROR };
    }
    if (url.username || url.password) {
      return { ok: false, error: LINK_ERROR };
    }
  } catch {
    return { ok: false, error: LINK_ERROR };
  }
  return { ok: true, value: link };
}

export function parseBucketForm(
  formData: Pick<FormData, "get">,
  options: { statusDefaultsToIdea: boolean },
): Parsed<BucketDraft> {
  const title = parseBucketTitle(formData.get("title"));
  if (!title.ok) return title;

  const categoryRaw = formData.get("category");
  if (typeof categoryRaw !== "string" || !isBucketCategory(categoryRaw)) {
    return { ok: false, error: CATEGORY_ERROR };
  }

  const statusRaw = formData.get("status");
  let status: BucketStatus = "idea";
  if (typeof statusRaw === "string" && statusRaw.length > 0) {
    if (!isBucketStatus(statusRaw)) return { ok: false, error: STATUS_ERROR };
    status = statusRaw;
  } else if (!options.statusDefaultsToIdea) {
    return { ok: false, error: STATUS_ERROR };
  }

  const plannedDate = parsePlannedDate(formData.get("plannedDate"));
  if (!plannedDate.ok) return plannedDate;
  const notes = parseBucketNotes(formData.get("notes"));
  if (!notes.ok) return notes;
  const link = parseBucketLink(formData.get("link"));
  if (!link.ok) return link;

  return {
    ok: true,
    value: {
      title: title.value,
      category: categoryRaw,
      status,
      plannedDate: plannedDate.value,
      notes: notes.value,
      link: link.value,
    },
  };
}

/** Formats a calendar date without shifting it into the viewer's previous day. */
export function formatPlannedDate(value: string): string {
  const match = DATE_PATTERN.exec(value);
  if (!match) return value;
  const utc = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(utc);
}

export const BUCKET_UNAVAILABLE =
  "The bucket list isn't available yet. Apply the week 5 SQL in the Supabase SQL editor, then try again.";

/** Maps a Postgres error from a bucket write onto a sentence, or null. */
export function bucketWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    (message?.includes("bucket_items") && message.includes("schema"))
  ) {
    return BUCKET_UNAVAILABLE;
  }
  if (
    message?.includes("bucket_items_link_shape") ||
    message?.includes("bucket_items_title_shape") ||
    message?.includes("bucket_items_notes_shape") ||
    message?.includes("bucket_items_category_known") ||
    message?.includes("bucket_items_status_known") ||
    message?.includes("bucket_items_done_has_completed") ||
    message?.includes("hsummer_bucket_locked")
  ) {
    return "That item isn't valid.";
  }
  if (
    message?.includes("row-level security") ||
    message?.includes("42501") ||
    code === "42501"
  ) {
    return "You can't change that item.";
  }
  return null;
}

export function authorLabel(
  createdBy: string | null,
  selfId: string,
  names: ReadonlyMap<string, string>,
): string {
  if (!createdBy) return "Former member";
  if (createdBy === selfId) return "you";
  return names.get(createdBy) ?? "Former member";
}
