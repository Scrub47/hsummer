/**
 * Photo booth rules shared by the camera page, the save actions, and the tests.
 *
 * Solo: shooting does not write a row. Save creates one complete session and
 * one photo-strip memory.
 *
 * Pass: the starter's frames create an open session. The partner fills the
 * other frames later. The memory is created only when every frame is in.
 * Live Together is later.
 */

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";
import { MEMORY_CAPTION_MAX, MEMORY_MAX_BYTES } from "@/lib/memories/fields";

export const BOOTH_THEMES = ["kawaii", "minimal"] as const;
export const BOOTH_LAYOUTS = ["4-cut", "2-cut"] as const;
export const BOOTH_FILTERS = [
  "none",
  "bw",
  "sepia",
  "warm",
  "cool",
  "grain",
] as const;

export type BoothTheme = (typeof BOOTH_THEMES)[number];
export type BoothLayout = (typeof BOOTH_LAYOUTS)[number];
export type BoothFilter = (typeof BOOTH_FILTERS)[number];

export const STRIP_WIDTH = 600;
export const STRIP_HEIGHT = 1800;

/** JPEG quality for a slot and for the downloaded strip. */
export const SHOT_JPEG_QUALITY = 0.9;

/**
 * Four slot JPEGs plus the multipart wrapper have to fit a server action.
 * Vercel refuses a body over 4.5 MB, and the action limit is 4 MB.
 */
export const BOOTH_TOTAL_MAX_BYTES = 3_500_000;

export const BOOTH_THEME_ERROR = "Pick Kawaii or Minimal.";
export const BOOTH_LAYOUT_ERROR = "Pick a 4-cut or a 2-cut strip.";
export const BOOTH_FILTER_ERROR = "Pick a filter.";
export const BOOTH_CAPTION_ERROR = "Keep the caption under 280 characters.";
export const BOOTH_SHOTS_ERROR =
  "Take every photo in the strip before you save it.";
export const BOOTH_JPEG_ERROR = "Each shot has to be a JPEG up to 2 MB.";
export const BOOTH_TOTAL_ERROR =
  "Those photos are too big to save together. Retake the strip.";
export const BOOTH_RATE_LIMIT_MESSAGE =
  "You've added a few memories just now. Wait a little and try again.";
export const BOOTH_UNAVAILABLE =
  "The photo booth can't save yet. Apply the week 13 SQL in the Supabase SQL editor, then try again.";

export const PASS_EXPIRES_DAYS = 7;
export const PASS_OPEN_LIMIT = 3;

export const PASS_UNAVAILABLE =
  "Pass the booth can't start yet. Apply the week 15 SQL in the Supabase SQL editor, then try again.";
export const PASS_PENDING =
  "Share the invite link first. Pass the booth starts once you're both here.";
export const PASS_GROUP =
  "Pass the booth is for the two of you. Choosing more people comes later.";
export const PASS_OPEN_MESSAGE =
  "You already have a few booths waiting. Finish or cancel one first.";
export const PASS_EXPIRED = "That booth expired before it was finished.";
export const PASS_CANCELLED = "That booth was cancelled.";
export const PASS_WAITING =
  "Passed on. They'll get a notification to take their frames.";
export const PASS_FINISHED = "The strip is on the memory wall for both of you.";

export type PassFrame = {
  position: number;
  url: string | null;
};

export type PassTurn = {
  sessionId: string;
  theme: BoothTheme;
  layout: BoothLayout;
  status: "open" | "expired" | "cancelled";
  expiresLabel: string | null;
  startedByMe: boolean;
  partnerName: string;
  myPositions: number[];
  frames: PassFrame[];
  caption: string | null;
  /** True when this person still has frames to take. */
  waitingOnYou: boolean;
};

export type PassBlocked = "pending" | "group" | "alone";

export const BOOTH_SHOT_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-3]\.jpg$/;

const themeSchema = z.enum(BOOTH_THEMES);
const layoutSchema = z.enum(BOOTH_LAYOUTS);
const filterSchema = z.enum(BOOTH_FILTERS);

export type BoothDraft = {
  circleId: string;
  theme: BoothTheme;
  layout: BoothLayout;
  filter: BoothFilter;
  caption: string | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function isBoothTheme(value: string): value is BoothTheme {
  return themeSchema.safeParse(value).success;
}

export function isBoothLayout(value: string): value is BoothLayout {
  return layoutSchema.safeParse(value).success;
}

export function isBoothFilter(value: string): value is BoothFilter {
  return filterSchema.safeParse(value).success;
}

export function shotCount(layout: BoothLayout): number {
  return layout === "4-cut" ? 4 : 2;
}

/** Top half. The person who starts a pass fills these. */
export function creatorPositions(layout: BoothLayout): number[] {
  return layout === "4-cut" ? [0, 1] : [0];
}

/** Bottom half. The partner fills these later. */
export function partnerPositions(layout: BoothLayout): number[] {
  return layout === "4-cut" ? [2, 3] : [1];
}

/** One filter when every contributor used it. Null when they differ. */
export function uniformFilter(filters: readonly string[]): BoothFilter | null {
  const known = filters.filter(isBoothFilter);
  if (known.length === 0) return null;
  const first = known[0];
  if (!first) return null;
  return known.every((filter) => filter === first) ? first : null;
}

export function isBoothShotPath(path: string): boolean {
  return BOOTH_SHOT_PATH.test(path);
}

export function filterLabel(filter: BoothFilter): string {
  if (filter === "none") return "No filter";
  if (filter === "bw") return "Black and white";
  if (filter === "sepia") return "Sepia";
  if (filter === "warm") return "Warm";
  if (filter === "cool") return "Cool";
  return "Grain";
}

export function layoutLabel(layout: BoothLayout): string {
  return layout === "4-cut" ? "4-cut" : "2-cut";
}

export function parseBoothForm(input: {
  circleId: unknown;
  theme: unknown;
  layout: unknown;
  filter: unknown;
  caption: unknown;
  shotCount: number;
}): Parsed<BoothDraft> {
  if (typeof input.circleId !== "string" || !isCircleId(input.circleId)) {
    return { ok: false, error: "That circle isn't available." };
  }
  const theme = themeSchema.safeParse(input.theme);
  if (!theme.success) return { ok: false, error: BOOTH_THEME_ERROR };
  const layout = layoutSchema.safeParse(input.layout);
  if (!layout.success) return { ok: false, error: BOOTH_LAYOUT_ERROR };
  const filter = filterSchema.safeParse(input.filter);
  if (!filter.success) return { ok: false, error: BOOTH_FILTER_ERROR };
  if (input.shotCount !== shotCount(layout.data)) {
    return { ok: false, error: BOOTH_SHOTS_ERROR };
  }

  const caption =
    typeof input.caption === "string" && input.caption.trim().length > 0
      ? input.caption.trim()
      : null;
  if (caption && [...caption].length > MEMORY_CAPTION_MAX) {
    return { ok: false, error: BOOTH_CAPTION_ERROR };
  }

  return {
    ok: true,
    value: {
      circleId: input.circleId,
      theme: theme.data,
      layout: layout.data,
      filter: filter.data,
      caption,
    },
  };
}

/** The starter sends only their half of the strip. */
export function parsePassStart(input: {
  circleId: unknown;
  theme: unknown;
  layout: unknown;
  filter: unknown;
  caption: unknown;
  shotCount: number;
}): Parsed<BoothDraft> {
  const theme = themeSchema.safeParse(input.theme);
  const layout = layoutSchema.safeParse(input.layout);
  const filter = filterSchema.safeParse(input.filter);
  if (!theme.success) return { ok: false, error: BOOTH_THEME_ERROR };
  if (!layout.success) return { ok: false, error: BOOTH_LAYOUT_ERROR };
  if (!filter.success) return { ok: false, error: BOOTH_FILTER_ERROR };
  if (typeof input.circleId !== "string" || !isCircleId(input.circleId)) {
    return { ok: false, error: "That circle isn't available." };
  }
  if (input.shotCount !== creatorPositions(layout.data).length) {
    return { ok: false, error: BOOTH_SHOTS_ERROR };
  }
  const caption =
    typeof input.caption === "string" && input.caption.trim().length > 0
      ? input.caption.trim()
      : null;
  if (caption && [...caption].length > MEMORY_CAPTION_MAX) {
    return { ok: false, error: BOOTH_CAPTION_ERROR };
  }
  return {
    ok: true,
    value: {
      circleId: input.circleId,
      theme: theme.data,
      layout: layout.data,
      filter: filter.data,
      caption,
    },
  };
}

const sessionIdSchema = z.string().uuid();

export function parsePassTurn(input: {
  sessionId: unknown;
  filter: unknown;
  shotCount: number;
}): Parsed<{ sessionId: string; filter: BoothFilter }> {
  const sessionId = sessionIdSchema.safeParse(input.sessionId);
  if (!sessionId.success) {
    return { ok: false, error: "That booth isn't available." };
  }
  const filter = filterSchema.safeParse(input.filter);
  if (!filter.success) return { ok: false, error: BOOTH_FILTER_ERROR };
  if (input.shotCount !== 1 && input.shotCount !== 2) {
    return { ok: false, error: BOOTH_SHOTS_ERROR };
  }
  return {
    ok: true,
    value: { sessionId: sessionId.data, filter: filter.data },
  };
}

export function parsePassCancel(input: {
  sessionId: unknown;
  circleId: unknown;
}): Parsed<{ sessionId: string; circleId: string }> {
  if (typeof input.circleId !== "string" || !isCircleId(input.circleId)) {
    return { ok: false, error: "That circle isn't available." };
  }
  const sessionId = sessionIdSchema.safeParse(input.sessionId);
  if (!sessionId.success) {
    return { ok: false, error: "That booth isn't available." };
  }
  return {
    ok: true,
    value: { sessionId: sessionId.data, circleId: input.circleId },
  };
}

/** Maps a Postgres error from a booth save onto a sentence, or null. */
export function boothWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  const demo = demoWriteMessage(message);
  if (demo) return demo;
  if (
    message?.includes("create_pass_booth") ||
    message?.includes("submit_pass_shots") ||
    message?.includes("finish_pass_booth") ||
    message?.includes("cancel_pass_booth") ||
    message?.includes("pass_the_booth")
  ) {
    return PASS_UNAVAILABLE;
  }
  if (
    code === "42883" ||
    code === "PGRST202" ||
    code === "42P01" ||
    message?.includes("save_solo_booth") ||
    (message?.includes("booth_sessions") && message.includes("schema"))
  ) {
    return BOOTH_UNAVAILABLE;
  }
  if (message?.includes("hsummer_booth_open")) {
    return PASS_OPEN_MESSAGE;
  }
  if (message?.includes("hsummer_rate_limited")) {
    return BOOTH_RATE_LIMIT_MESSAGE;
  }
  if (message?.includes("hsummer_storage_quota")) {
    return "This circle is out of photo space. Delete a photo to add another.";
  }
  if (message?.includes("hsummer_booth_memory")) {
    return "That strip isn't valid.";
  }
  return null;
}

export { MEMORY_MAX_BYTES };
