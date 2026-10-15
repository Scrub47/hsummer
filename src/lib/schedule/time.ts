/**
 * Calendar dates and the recipient's local clock.
 *
 * A countdown date has no time and no zone. Days remaining are calendar
 * days in the viewer's own timezone. A scheduled letter is a wall-clock
 * time in the recipient's timezone, stored as a UTC instant.
 */

import { z } from "zod";

import { isIanaTimeZone } from "@/lib/profile/fields";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export const SCHEDULE_MIN_LEAD_MS = 60 * 1000;
export const SCHEDULE_MAX_LEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export const SCHEDULE_TIME_ERROR = "Pick a date and a time.";
export const SCHEDULE_ZONE_ERROR = "Their timezone isn't set yet.";
export const SCHEDULE_GAP_ERROR =
  "That time doesn't exist in their time zone. Pick another minute.";
export const SCHEDULE_LEAD_ERROR =
  "Pick a time at least a minute from now, in their time zone.";
export const SCHEDULE_FAR_ERROR = "Pick a time within the next two years.";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const deliverySchema = z.discriminatedUnion("when", [
  z.object({ when: z.literal("now") }),
  z.object({
    when: z.literal("later"),
    date: z.string().regex(DATE_PATTERN),
    time: z.string().regex(TIME_PATTERN),
  }),
]);

export function calendarDate(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: isIanaTimeZone(timeZone) ? timeZone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return DATE_PATTERN.test(parts) ? parts : now.toISOString().slice(0, 10);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Calendar days from the viewer's today to a YYYY-MM-DD date. */
export function daysUntil(
  targetDate: string,
  timeZone: string,
  now = new Date(),
): number | null {
  if (!DATE_PATTERN.test(targetDate)) return null;
  const today = calendarDate(timeZone, now);
  const target = utcDayNumber(targetDate);
  const current = utcDayNumber(today);
  if (target == null || current == null) return null;
  return Math.round((target - current) / 86_400_000);
}

export function formatCalendarDate(value: string): string {
  if (!DATE_PATTERN.test(value)) return value;
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatInZone(iso: string, timeZone: string): string | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const zone = isIanaTimeZone(timeZone) ? timeZone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      dateStyle: "long",
      timeStyle: "short",
    }).format(instant);
  } catch {
    return null;
  }
}

export function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days === -1) return "1 day ago";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `${days} days`;
}

/**
 * An empty or missing choice means deliver now, which is what a letter
 * form did before scheduling existed.
 */
export function parseDeliveryChoice(input: {
  when: unknown;
  date: unknown;
  time: unknown;
}): Parsed<{ when: "now" } | { when: "later"; date: string; time: string }> {
  const when = input.when == null || input.when === "" ? "now" : input.when;
  if (when === "now") return { ok: true, value: { when: "now" } };

  const date = typeof input.date === "string" ? input.date.trim() : "";
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const parsed = deliverySchema.safeParse({ when, date, time });
  if (!parsed.success || parsed.data.when !== "later") {
    return { ok: false, error: SCHEDULE_TIME_ERROR };
  }

  const match = TIME_PATTERN.exec(parsed.data.time);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (hour > 23 || minute > 59) {
    return { ok: false, error: SCHEDULE_TIME_ERROR };
  }

  return { ok: true, value: parsed.data };
}

/** Wall-clock date and time in an IANA zone, as a UTC instant. */
export function scheduleInstant(input: {
  date: string;
  time: string;
  timeZone: string;
  now?: Date;
}): Parsed<string> {
  if (!isIanaTimeZone(input.timeZone)) {
    return { ok: false, error: SCHEDULE_ZONE_ERROR };
  }

  const utc = zonedLocalToUtc(input.date, input.time, input.timeZone);
  if (!utc) return { ok: false, error: SCHEDULE_GAP_ERROR };

  const now = input.now ?? new Date();
  const lead = utc.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) {
    return { ok: false, error: SCHEDULE_LEAD_ERROR };
  }
  if (lead > SCHEDULE_MAX_LEAD_MS) {
    return { ok: false, error: SCHEDULE_FAR_ERROR };
  }

  return { ok: true, value: utc.toISOString() };
}

export function zonedLocalToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const dateMatch = DATE_PATTERN.exec(date);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!dateMatch || !timeMatch || !isIanaTimeZone(timeZone)) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const utc = new Date(wall - zoneOffsetMs(new Date(wall), timeZone));
  const offsetAtUtc = zoneOffsetMs(utc, timeZone);
  const adjusted = new Date(wall - offsetAtUtc);
  const seen = wallClock(adjusted, timeZone);
  if (!seen) return null;
  if (seen.date !== date || seen.time !== time) return null;
  return adjusted;
}

function utcDayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const seen = wallClock(instant, timeZone);
  if (!seen) return 0;
  const [year, month, day] = seen.date.split("-").map(Number);
  const [hour, minute] = seen.time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, seen.second);
  return asUtc - instant.getTime();
}

function wallClock(
  instant: Date,
  timeZone: string,
): { date: string; time: string; second: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    let hour = read("hour");
    if (hour === "24") hour = "00";
    const date = `${read("year")}-${read("month")}-${read("day")}`;
    const time = `${hour}:${read("minute")}`;
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
    return { date, time, second: Number(read("second")) || 0 };
  } catch {
    return null;
  }
}
