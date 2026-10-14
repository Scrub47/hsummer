/**
 * Circle and invite rules shared by the server actions and the unit tests.
 *
 * The database is the backstop. This module rejects the same shapes before
 * a request, and it is where the join and invite-creation limits live so the
 * tests can name them. Week 3 enforces redemption. Week 5 enforces new links.
 *
 * Group, family, and friends circles use the same tables as a couple.
 * The type chooses defaults and copy. It is not a permission.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";

export const CIRCLE_TYPES = ["couple", "group", "family", "friends"] as const;
export type CircleType = (typeof CIRCLE_TYPES)[number];
export type CircleStatus = "pending" | "active" | "archived";

/**
 * Group, family, and friends circles are offered in the create form.
 * The constant stays so a test can name the phase. It is not a second gate.
 */
export const GROUP_CIRCLE_TYPES_ENABLED = true;

export const JOIN_USER_LIMIT = 8;
export const JOIN_IP_LIMIT = 20;
export const JOIN_WINDOW_MINUTES = 15;
export const INVITE_DAYS = 7;

/**
 * New invite rows, from creating a circle or making a new link.
 * The week 5 trigger enforces this. Upstash uses the same numbers when set.
 */
export const INVITE_WRITE_LIMIT = 10;
export const INVITE_WRITE_WINDOW_MINUTES = 15;
export const INVITE_RATE_LIMIT_MESSAGE =
  "You've made several invite links just now. Wait a little and try again.";

export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const CIRCLE_NAME_ERROR =
  "Use a name up to 80 characters, without an email address.";
export const CIRCLE_TYPE_ERROR =
  "Pick a couple, group, family, or friends circle.";

const KNOWN_INVITE_STATES = [
  "missing",
  "revoked",
  "expired",
  "full",
  "already_member",
  "ready",
  "joined",
  "rate_limited",
] as const;

export type InviteState = (typeof KNOWN_INVITE_STATES)[number];

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function isCircleType(value: string): value is CircleType {
  return (CIRCLE_TYPES as readonly string[]).includes(value);
}

export function isCircleStatus(value: string): value is CircleStatus {
  return value === "pending" || value === "active" || value === "archived";
}

export function isInviteState(value: string): value is InviteState {
  return (KNOWN_INVITE_STATES as readonly string[]).includes(value);
}

/** True when the create form may offer this type. */
export function circleTypeOffered(type: CircleType): boolean {
  if (type === "couple") return true;
  return GROUP_CIRCLE_TYPES_ENABLED;
}

/**
 * A picker is for a circle that already has you and at least two other
 * people. A couple, and any circle of two, skips it: the other person is
 * the recipient.
 */
export function circleNeedsPicker(otherMemberCount: number): boolean {
  return otherMemberCount > 1;
}

export function parseCircleType(value: unknown): Parsed<CircleType> {
  const parsed = z.string().safeParse(value);
  if (!parsed.success || !isCircleType(parsed.data)) {
    return { ok: false, error: CIRCLE_TYPE_ERROR };
  }
  if (!circleTypeOffered(parsed.data)) {
    return { ok: false, error: CIRCLE_TYPE_ERROR };
  }
  return { ok: true, value: parsed.data };
}

/** Empty input is "no name". A name cannot carry an email address. */
export function parseCircleName(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  const parsed = z.string().safeParse(value);
  if (!parsed.success) return { ok: false, error: CIRCLE_NAME_ERROR };
  const name = parsed.data.trim();
  if (name.length === 0) return { ok: true, value: null };
  if ([...name].length > 80 || name.includes("@")) {
    return { ok: false, error: CIRCLE_NAME_ERROR };
  }
  return { ok: true, value: name };
}

export function maxUsesForType(type: CircleType): number | null {
  return type === "couple" ? 1 : null;
}

export function isInviteToken(value: string): boolean {
  return INVITE_TOKEN_PATTERN.test(value);
}

/** SHA-256 hex of the raw token. Matches private.hash_invite_token. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Counts include the attempt that is being judged, which is how the SQL
 * function counts after it inserts the row.
 */
export function joinAttemptAllowed(input: {
  userHits: number;
  ipHits: number;
}): boolean {
  return input.userHits <= JOIN_USER_LIMIT && input.ipHits <= JOIN_IP_LIMIT;
}

export function inviteStateMessage(state: string): string | null {
  switch (state) {
    case "revoked":
      return "This invite link has been turned off. Ask for a new one.";
    case "expired":
      return "This invite link has expired. Ask for a new one.";
    case "full":
      return "This circle is already full.";
    case "already_member":
      return "You're already in this circle.";
    case "rate_limited":
      return "Too many tries just now. Wait a little and try again.";
    case "missing":
      return "This invite link isn't valid.";
    case "demo":
      return "This demo circle is only for looking. It doesn't take new people.";
    default:
      return null;
  }
}

export function circleTitle(name: string | null, type: CircleType): string {
  if (name && name.trim().length > 0) return name.trim();
  if (type === "family") return "Your family";
  if (type === "friends") return "Your friends";
  if (type === "group") return "Your group";
  return "Your circle";
}

export function inviteStorageKey(inviteId: string): string {
  return `hsummer.invite.${inviteId}`;
}

/** Maps a Postgres error from the circle RPCs onto a sentence for the form. */
export function circleRpcFailure(message: string | undefined): string | null {
  if (!message) return null;
  const demo = demoWriteMessage(message);
  if (demo) return demo;
  if (message.includes("hsummer_rate_limited"))
    return INVITE_RATE_LIMIT_MESSAGE;
  if (message.includes("hsummer_bad_name")) return CIRCLE_NAME_ERROR;
  if (message.includes("hsummer_bad_type")) return CIRCLE_TYPE_ERROR;
  if (message.includes("hsummer_not_member")) {
    return "You can't change this circle.";
  }
  return null;
}

export function joinPath(token: string): string {
  return `/join/${token}`;
}

/** First forwarded hop, else the platform's real IP, else a shared bucket. */
export function requestIp(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  const candidate = first || headerList.get("x-real-ip")?.trim() || "unknown";
  return candidate.slice(0, 200);
}

/** Hex SHA-256. The raw IP is not stored. */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`hsummer-join-v1:${ip}`, "utf8")
    .digest("hex");
}
