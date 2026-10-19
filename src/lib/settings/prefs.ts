/**
 * Owner-only notification settings stored on account_private.notification_prefs.
 *
 * Missing keys keep the original behavior: every notification on, sounds off,
 * theme following the system, quiet hours off. The database still only
 * requires a JSON object. This module is the shape the app writes.
 */

import { z } from "zod";

export const NOTIFY_KINDS = [
  "pings",
  "letters",
  "booth",
  "stillUs",
  "group",
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const REACTION_EMOJIS = [
  { code: "heart", glyph: "❤️", label: "Love" },
  { code: "adore", glyph: "🥰", label: "Adore" },
  { code: "hug", glyph: "🤗", label: "Hug" },
  { code: "spark", glyph: "✨", label: "Sparkle" },
  { code: "letter", glyph: "💌", label: "Letter" },
] as const;

export type ReactionCode = (typeof REACTION_EMOJIS)[number]["code"];

export const REACTION_LIMIT = 30;
export const REACTION_WINDOW_MINUTES = 10;
export const REPLY_LIMIT = 20;
export const REPLY_WINDOW_MINUTES = 10;
export const REPLY_MAX = 280;

export const REACTION_RATE_LIMIT_MESSAGE =
  "That's a lot of reactions. Wait a few minutes and try again.";
export const REPLY_RATE_LIMIT_MESSAGE =
  "That's a lot of replies. Wait a few minutes and try again.";

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type QuietWindow = {
  enabled: boolean;
  start: string;
  end: string;
};

export type NotificationPrefs = {
  pings: boolean;
  letters: boolean;
  booth: boolean;
  stillUs: boolean;
  group: boolean;
  sounds: boolean;
  theme: ThemeChoice;
  quiet: QuietWindow;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  pings: true,
  letters: true,
  booth: true,
  stillUs: true,
  group: true,
  sounds: false,
  theme: "system",
  quiet: { enabled: false, start: "22:00", end: "08:00" },
};

const flag = z.boolean().optional();

const prefsSchema = z.object({
  pings: flag,
  letters: flag,
  booth: flag,
  stillUs: flag,
  group: flag,
  sounds: flag,
  theme: z.unknown().optional(),
  quiet: z.unknown().optional(),
});

const quietSchema = z.object({
  enabled: flag,
  start: z.string().optional(),
  end: z.string().optional(),
});

function clockOr(value: string | undefined, fallback: string): string {
  if (!value || !CLOCK.test(value)) return fallback;
  return value;
}

/**
 * Fills defaults and drops a field that is the wrong shape. A bad theme or
 * a bad clock does not throw away the toggles next to it.
 */
export function parsePrefs(value: unknown): NotificationPrefs {
  const parsed = prefsSchema.safeParse(value);
  const data = parsed.success ? parsed.data : {};
  const theme = z.enum(THEMES).safeParse(data.theme);
  const quiet = quietSchema.safeParse(data.quiet);
  const quietData = quiet.success ? quiet.data : {};
  return {
    pings: data.pings ?? DEFAULT_PREFS.pings,
    letters: data.letters ?? DEFAULT_PREFS.letters,
    booth: data.booth ?? DEFAULT_PREFS.booth,
    stillUs: data.stillUs ?? DEFAULT_PREFS.stillUs,
    group: data.group ?? DEFAULT_PREFS.group,
    sounds: data.sounds ?? DEFAULT_PREFS.sounds,
    theme: theme.success ? theme.data : DEFAULT_PREFS.theme,
    quiet: {
      enabled: quietData.enabled ?? DEFAULT_PREFS.quiet.enabled,
      start: clockOr(quietData.start, DEFAULT_PREFS.quiet.start),
      end: clockOr(quietData.end, DEFAULT_PREFS.quiet.end),
    },
  };
}

export function allowsKind(
  prefs: NotificationPrefs,
  kind: NotifyKind,
  circleType: string | null,
): boolean {
  if (!prefs[kind]) return false;
  if (circleType && circleType !== "couple" && !prefs.group) return false;
  return true;
}

export function clockMinutes(value: string): number | null {
  const match = CLOCK.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isQuietMinute(
  nowMin: number,
  startMin: number,
  endMin: number,
): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

/** "08:00" becomes "8 AM". "08:30" becomes "8:30 AM". */
export function formatResumeLabel(hhmm: string): string {
  const minutes = clockMinutes(hhmm);
  if (minutes == null) return hhmm;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  if (minute === 0) return `${hour12} ${suffix}`;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function minutesInZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return (hour % 24) * 60 + minute;
  } catch {
    return minutesInZone(now, "UTC");
  }
}

type LocalDate = { year: number; month: number; day: number };

function localDate(now: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function addDays(date: LocalDate, days: number): LocalDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

/** The next time `hhmm` happens in `timeZone`, as a UTC instant. */
export function zonedClockToUtc(
  day: LocalDate,
  hhmm: string,
  timeZone: string,
): Date {
  const minutes = clockMinutes(hhmm) ?? 0;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  const first = new Date(guess - offset);
  const corrected = zoneOffsetMs(first, timeZone);
  return new Date(guess - corrected);
}

export type QuietDecision = {
  inQuiet: boolean;
  resumeLabel: string | null;
  deliverAt: string | null;
};

export function quietDecision(input: {
  prefs: NotificationPrefs;
  timeZone: string;
  now?: Date;
}): QuietDecision {
  const now = input.now ?? new Date();
  if (!input.prefs.quiet.enabled) {
    return { inQuiet: false, resumeLabel: null, deliverAt: null };
  }
  const start = clockMinutes(input.prefs.quiet.start);
  const end = clockMinutes(input.prefs.quiet.end);
  if (start == null || end == null) {
    return { inQuiet: false, resumeLabel: null, deliverAt: null };
  }
  const zone = input.timeZone || "UTC";
  const nowMin = minutesInZone(now, zone);
  if (!isQuietMinute(nowMin, start, end)) {
    return { inQuiet: false, resumeLabel: null, deliverAt: null };
  }
  let day = localDate(now, zone);
  if (start > end && nowMin >= start) day = addDays(day, 1);
  const deliverAt = zonedClockToUtc(day, input.prefs.quiet.end, zone);
  return {
    inQuiet: true,
    resumeLabel: formatResumeLabel(input.prefs.quiet.end),
    deliverAt: deliverAt.toISOString(),
  };
}

/** The sentence the sender sees. "Summer's in quiet hours, we'll deliver it at 8 AM". */
export function quietNotice(name: string, resumeLabel: string): string {
  const who = name.trim();
  if (!who) {
    return `They're in quiet hours, we'll deliver it at ${resumeLabel}`;
  }
  return `${who}'s in quiet hours, we'll deliver it at ${resumeLabel}`;
}

export function isReactionCode(value: string): value is ReactionCode {
  return REACTION_EMOJIS.some((emoji) => emoji.code === value);
}

export function reactionGlyph(code: string): string {
  return REACTION_EMOJIS.find((emoji) => emoji.code === code)?.glyph ?? "";
}
