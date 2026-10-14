/**
 * Letter rules shared by the form, the server action, and the tests.
 *
 * The seven open-when categories are the defaults. A circle can add its
 * own. The database checks the same shapes. A signed-in person can write
 * 10 letters in 10 minutes. Delivery on a clock is a later week; a letter
 * written here is delivered as it is saved.
 */

import { z } from "zod";

import { isCircleId } from "@/lib/bucket/fields";

export const DEFAULT_LETTER_CATEGORIES = [
  { slug: "need-motivation", label: "Need motivation" },
  { slug: "need-help", label: "Need help" },
  { slug: "feeling-sad", label: "Feeling sad" },
  { slug: "feeling-lonely", label: "Feeling lonely" },
  { slug: "distance-is-too-hard", label: "Distance is too hard" },
  { slug: "when-we-fight", label: "When we fight" },
  { slug: "when-you-miss-me", label: "When you miss me" },
] as const;

export const LETTER_DESIGNS = [
  { value: "minimal", label: "Minimal" },
  { value: "kawaii", label: "Kawaii" },
  { value: "retro-film", label: "Retro film" },
] as const;

export type LetterDesign = (typeof LETTER_DESIGNS)[number]["value"];
export type LetterCategorySlug =
  (typeof DEFAULT_LETTER_CATEGORIES)[number]["slug"];

export const LETTER_BODY_MAX = 8000;
export const LETTER_TITLE_MAX = 80;
export const LETTER_CATEGORY_MAX = 40;
export const LETTER_LIMIT = 10;
export const LETTER_WINDOW_MINUTES = 10;

export const LETTER_RATE_LIMIT_MESSAGE =
  "You've written a few letters just now. Wait a little and try again.";

export const LETTER_UNAVAILABLE =
  "Letters aren't available yet. Apply the week 11 SQL in the Supabase SQL editor, then try again.";

export const LETTER_CATEGORY_ERROR = "Pick a category from the list.";
export const LETTER_CATEGORY_LABEL_ERROR =
  "Use a category up to 40 letters, numbers, spaces, apostrophes, or hyphens.";
export const LETTER_BODY_ERROR = "Write a letter up to 8,000 characters.";
export const LETTER_TITLE_ERROR =
  "Use a title up to 80 characters, without an @.";
export const LETTER_DESIGN_ERROR = "Pick a design.";

const CATEGORY_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '-]{0,39}$/;
const designSchema = z.enum(["minimal", "kawaii", "retro-film"]);

export type LetterDraft = {
  category: string;
  title: string | null;
  body: string;
  design: LetterDesign;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export { isCircleId };

export function isLetterDesign(value: string): value is LetterDesign {
  return value === "minimal" || value === "kawaii" || value === "retro-film";
}

export function isDefaultLetterCategory(
  value: string,
): value is LetterCategorySlug {
  return DEFAULT_LETTER_CATEGORIES.some((category) => category.slug === value);
}

/** The line at the top of every letter. The name is the recipient's. */
export function dearHeading(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return "Dear Former member";
  return `Dear ${trimmed}`;
}

export function categoryLabel(
  category: string,
  customLabels: readonly string[] = [],
): string {
  const known = DEFAULT_LETTER_CATEGORIES.find(
    (item) => item.slug === category,
  );
  if (known) return known.label;
  if (customLabels.includes(category)) return category;
  return category;
}

export function parseCategoryLabel(value: unknown): Parsed<string> {
  if (typeof value !== "string") {
    return { ok: false, error: LETTER_CATEGORY_LABEL_ERROR };
  }
  const label = value.trim().replace(/\s+/g, " ");
  if (
    [...label].length < 1 ||
    [...label].length > LETTER_CATEGORY_MAX ||
    !CATEGORY_LABEL_PATTERN.test(label) ||
    label.includes("@")
  ) {
    return { ok: false, error: LETTER_CATEGORY_LABEL_ERROR };
  }
  if (isBuiltInCategory(label)) {
    return { ok: false, error: "That category is already on the list." };
  }
  return { ok: true, value: label };
}

export function parseLetterDraft(input: {
  category: unknown;
  title: unknown;
  body: unknown;
  design: unknown;
  customLabels: readonly string[];
}): Parsed<LetterDraft> {
  const design = designSchema.safeParse(input.design);
  if (!design.success) return { ok: false, error: LETTER_DESIGN_ERROR };

  const category =
    typeof input.category === "string" ? input.category.trim() : "";
  const custom = input.customLabels.filter((label) => label.trim() === label);
  if (!isDefaultLetterCategory(category) && !custom.includes(category)) {
    return { ok: false, error: LETTER_CATEGORY_ERROR };
  }

  const title = parseTitle(input.title);
  if (!title.ok) return title;

  if (typeof input.body !== "string") {
    return { ok: false, error: LETTER_BODY_ERROR };
  }
  const body = input.body.trim();
  if ([...body].length < 1 || [...body].length > LETTER_BODY_MAX) {
    return { ok: false, error: LETTER_BODY_ERROR };
  }

  return {
    ok: true,
    value: {
      category,
      title: title.value,
      body,
      design: design.data,
    },
  };
}

/** Maps a Postgres error from a letter write onto a sentence, or null. */
export function letterWriteFailure(
  message: string | undefined,
  code: string | undefined,
): string | null {
  if (!message && !code) return null;
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST202" ||
    (message?.includes("letters") && message.includes("schema")) ||
    (message?.includes("letter_categories") && message.includes("schema")) ||
    message?.includes("open_letter")
  ) {
    return LETTER_UNAVAILABLE;
  }
  if (message?.includes("hsummer_rate_limited")) {
    return LETTER_RATE_LIMIT_MESSAGE;
  }
  if (
    message?.includes("hsummer_letter_category") ||
    message?.includes("letter_categories_label_idx") ||
    message?.includes("duplicate key")
  ) {
    return "Pick a category from the list, or add one that isn't already there.";
  }
  if (message?.includes("hsummer_letter_recipient")) {
    return "That letter needs both of you still in the circle.";
  }
  if (message?.includes("hsummer_letter_sender")) {
    return "You can only write as yourself.";
  }
  if (
    message?.includes("hsummer_letter_locked") ||
    message?.includes("hsummer_letter_open") ||
    message?.includes("hsummer_letter_memory")
  ) {
    return "That letter can't be changed.";
  }
  if (
    message?.includes("letters_body_shape") ||
    message?.includes("letters_title_shape") ||
    message?.includes("letters_design_known") ||
    message?.includes("letters_category_shape") ||
    message?.includes("letters_not_self")
  ) {
    return "That letter isn't valid.";
  }
  if (
    message?.includes("row-level security") ||
    message?.includes("42501") ||
    code === "42501"
  ) {
    return "You can't change that letter.";
  }
  return null;
}

function parseTitle(value: unknown): Parsed<string | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string")
    return { ok: false, error: LETTER_TITLE_ERROR };
  const title = value.trim();
  if (!title) return { ok: true, value: null };
  if (
    [...title].length > LETTER_TITLE_MAX ||
    title.includes("@") ||
    /[\u0000-\u001F\u007F]/.test(title)
  ) {
    return { ok: false, error: LETTER_TITLE_ERROR };
  }
  return { ok: true, value: title };
}

function isBuiltInCategory(label: string): boolean {
  const folded = label.toLowerCase();
  return DEFAULT_LETTER_CATEGORIES.some(
    (category) =>
      category.slug === folded || category.label.toLowerCase() === folded,
  );
}
