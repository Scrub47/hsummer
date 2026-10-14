/**
 * Thinking of You rules shared by the route, the button, and the unit tests.
 *
 * The database is the backstop. This module rejects the same shapes before a
 * request, and it is where the rate-limit numbers live so the tests can name
 * them. The week 4 insert trigger enforces those numbers. Week 5 checks the
 * same cap in the route (and in Upstash, when that is configured) and still
 * leaves the trigger in place, so a direct insert cannot skip it.
 *
 * A whole-circle ping (to_user_id null) is a real row shape. A couple cannot
 * send one. A circle of two skips the picker and pings the other person.
 * A larger circle can ping one person or everyone.
 *
 * A shared mood is the same insert with ping_type mood-share. The public
 * POST route still refuses a mood field. The circle page builds that row
 * only when the share box is checked.
 */

import { z } from "zod";

import { demoWriteMessage } from "@/lib/account/copy";
import { isMoodEmoji, type MoodEmoji } from "@/lib/moods/fields";

/** Whole-circle pings are on for groups. A couple still cannot send one. */
export const BROADCAST_PINGS_ENABLED = true;

/** Successful sends inside the window. The 11th is refused. */
export const PING_LIMIT = 10;
export const PING_WINDOW_MINUTES = 10;

export const PING_RATE_LIMIT_MESSAGE =
  "You've sent a few of these just now. Wait a little and try again.";

export const PING_BROADCAST_ERROR =
  "Choose one person, or everyone. A couple always pings their partner.";

const CIRCLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartnerResolution =
  | { ok: true; partnerId: string }
  | {
      ok: false;
      reason:
        "archived" | "not_couple" | "pending" | "no_partner" | "ambiguous";
    };

export type RecipientRequest =
  | { kind: "auto" }
  | { kind: "member"; userId: string }
  | { kind: "broadcast" };

export type RecipientResolution =
  | { ok: true; toUserId: string | null; mode: "partner" | "chosen" | "broadcast" }
  | {
      ok: false;
      reason:
        | "archived"
        | "pending"
        | "no_partner"
        | "ambiguous"
        | "not_member"
        | "broadcast_refused"
        | "needs_choice"
        | "couple_picker";
    };

type Parsed =
  | {
      ok: true;
      circleId: string;
      secretVariant: boolean;
      recipient: RecipientRequest;
    }
  | { ok: false; status: 400; error: string };

/**
 * `recentCount` is how many pings this person already sent inside the window,
 * not including the one being judged.
 */
export function pingSendAllowed(recentCount: number): boolean {
  return (
    Number.isInteger(recentCount) &&
    recentCount >= 0 &&
    recentCount < PING_LIMIT
  );
}

/**
 * In a couple there is one other person, so the tap has no picker.
 * Group circles are refused here even when the table would accept a row.
 */
export function resolveCouplePartner(input: {
  selfId: string;
  circleType: string;
  status: string;
  activeMemberIds: readonly string[];
}): PartnerResolution {
  if (input.status === "archived") return { ok: false, reason: "archived" };
  if (input.circleType !== "couple") return { ok: false, reason: "not_couple" };
  if (input.status !== "active") return { ok: false, reason: "pending" };

  const others = input.activeMemberIds.filter((id) => id !== input.selfId);
  if (others.length === 0) return { ok: false, reason: "no_partner" };
  if (others.length > 1) return { ok: false, reason: "ambiguous" };

  const partnerId = others[0];
  if (!partnerId) return { ok: false, reason: "no_partner" };
  return { ok: true, partnerId };
}

/**
 * Body of POST /api/pings. A couple omits the recipient. A larger circle
 * sends `toUserId` as a member id, or null for everyone.
 */
const pingBodySchema = z.record(z.string(), z.unknown());
const userIdSchema = z.string().regex(CIRCLE_ID_PATTERN);

export function parsePingRequest(body: unknown): Parsed {
  const parsed = pingBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Send a circle id." };
  }

  const record = parsed.data;
  if (
    "pingType" in record ||
    "type" in record ||
    "moodEmoji" in record ||
    "mood_emoji" in record
  ) {
    return { ok: false, status: 400, error: PING_BROADCAST_ERROR };
  }

  const circleId = userIdSchema.safeParse(record.circleId);
  if (!circleId.success) {
    return { ok: false, status: 400, error: "That circle isn't available." };
  }

  if ("secretVariant" in record && typeof record.secretVariant !== "boolean") {
    return { ok: false, status: 400, error: "That ping isn't valid." };
  }

  let recipient: RecipientRequest = { kind: "auto" };
  if ("toUserId" in record || "to_user_id" in record) {
    const raw = "toUserId" in record ? record.toUserId : record.to_user_id;
    if (raw === null) {
      recipient = { kind: "broadcast" };
    } else {
      const id = userIdSchema.safeParse(raw);
      if (!id.success) {
        return {
          ok: false,
          status: 400,
          error: "Choose a person in this circle.",
        };
      }
      recipient = { kind: "member", userId: id.data };
    }
  }

  if (recipient.kind === "broadcast" && record.secretVariant === true) {
    return {
      ok: false,
      status: 400,
      error: "The Missing note goes to one person.",
    };
  }

  return {
    ok: true,
    circleId: circleId.data,
    secretVariant: record.secretVariant === true,
    recipient,
  };
}

/**
 * Who a letter or a ping is for.
 *
 * A couple, and any circle with exactly one other person, ignores a picker:
 * the request has to be "auto". A larger circle must name one member.
 * Broadcast is a ping to everyone, and only there.
 */
export function resolveCircleRecipient(input: {
  selfId: string;
  circleType: string;
  status: string;
  activeMemberIds: readonly string[];
  request: RecipientRequest;
  allowBroadcast: boolean;
}): RecipientResolution {
  if (input.status === "archived") return { ok: false, reason: "archived" };
  if (input.status !== "active") return { ok: false, reason: "pending" };

  const others = input.activeMemberIds.filter((id) => id !== input.selfId);
  if (others.length === 0) return { ok: false, reason: "no_partner" };

  const pair = input.circleType === "couple" || others.length === 1;
  if (input.request.kind === "broadcast") {
    if (
      !input.allowBroadcast ||
      !BROADCAST_PINGS_ENABLED ||
      input.circleType === "couple" ||
      others.length < 2
    ) {
      return { ok: false, reason: "broadcast_refused" };
    }
    return { ok: true, toUserId: null, mode: "broadcast" };
  }

  if (input.request.kind === "member") {
    if (pair) return { ok: false, reason: "couple_picker" };
    if (!others.includes(input.request.userId)) {
      return { ok: false, reason: "not_member" };
    }
    return { ok: true, toUserId: input.request.userId, mode: "chosen" };
  }

  if (!pair) return { ok: false, reason: "needs_choice" };
  if (others.length !== 1) return { ok: false, reason: "ambiguous" };
  const partnerId = others[0];
  if (!partnerId) return { ok: false, reason: "no_partner" };
  return { ok: true, toUserId: partnerId, mode: "partner" };
}

export function recipientReasonMessage(
  reason: Exclude<RecipientResolution, { ok: true }>["reason"],
  kind: "ping" | "letter",
): { status: number; error: string } {
  switch (reason) {
    case "pending":
    case "no_partner":
      return {
        status: 409,
        error:
          kind === "letter"
            ? "Share the invite link first. Letters open once you're both here."
            : "This circle is still waiting for someone else. Share the invite link.",
      };
    case "broadcast_refused":
      return {
        status: 400,
        error:
          kind === "letter"
            ? "A letter goes to one person."
            : "Thinking of You in a couple goes to your partner.",
      };
    case "couple_picker":
      return {
        status: 400,
        error:
          kind === "letter"
            ? "This letter goes to your partner."
            : "Thinking of You goes to your partner.",
      };
    case "needs_choice":
      return {
        status: 400,
        error:
          kind === "letter"
            ? "Choose who this letter is for."
            : "Choose who this is for, or everyone.",
      };
    case "not_member":
      return { status: 400, error: "Choose someone who is in this circle." };
    case "ambiguous":
      return {
        status: 400,
        error: "Thinking of You needs exactly one partner in this circle.",
      };
    case "archived":
      return { status: 404, error: "That circle isn't available." };
  }
}

/** Form field. Missing means the circle of two should pick the other person. */
export function parseRecipientField(value: unknown): RecipientRequest | null {
  if (value === null || value === undefined) return { kind: "auto" };
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "auto" };
  if (trimmed === "everyone") return { kind: "broadcast" };
  const id = userIdSchema.safeParse(trimmed);
  if (!id.success) return null;
  return { kind: "member", userId: id.data };
}

/** In-app phrase. The push payload must not use this — it contains a name. */
export function missingName(displayName: string): string {
  const name = displayName.trim();
  return `Missing ${name.length > 0 ? name : "them"}`;
}

export function pingPhrase(
  secretVariant: boolean,
  recipientName: string,
): string {
  if (secretVariant) return missingName(recipientName);
  return "Thinking of you";
}

export function partnerReasonMessage(
  reason: Exclude<PartnerResolution, { ok: true }>["reason"],
): { status: number; error: string } {
  switch (reason) {
    case "pending":
    case "no_partner":
      return {
        status: 409,
        error:
          "This circle is still waiting for your partner. Share the invite link.",
      };
    case "not_couple":
      return {
        status: 400,
        error: "Choose who this is for, or everyone.",
      };
    case "ambiguous":
      return {
        status: 400,
        error: "Thinking of You needs exactly one partner in this circle.",
      };
    case "archived":
      return { status: 404, error: "That circle isn't available." };
  }
}

export type CirclePingRow = {
  circle_id: string;
  from_user_id: string;
  to_user_id: string | null;
  ping_type: "thinking-of-you" | "mood-share";
  mood_emoji: string | null;
  secret_variant: boolean;
};

/**
 * The row Thinking of You and a shared mood both insert.
 * A mood share is not the Missing variant, and the emoji has to be one of
 * the current-mood palette. The public POST route still refuses a mood
 * field; the circle page calls this from the share checkbox.
 */
export function circlePingInsert(input: {
  circleId: string;
  fromUserId: string;
  toUserId: string | null;
  secretVariant: boolean;
  moodEmoji: string | null;
}): { ok: true; row: CirclePingRow } | { ok: false; error: string } {
  if (input.toUserId === null && input.secretVariant) {
    return { ok: false, error: "The Missing note goes to one person." };
  }
  if (input.moodEmoji != null) {
    if (input.secretVariant || !isMoodEmoji(input.moodEmoji)) {
      return { ok: false, error: "That mood isn't one you can share." };
    }
    const emoji: MoodEmoji = input.moodEmoji;
    return {
      ok: true,
      row: {
        circle_id: input.circleId,
        from_user_id: input.fromUserId,
        to_user_id: input.toUserId,
        ping_type: "mood-share",
        mood_emoji: emoji,
        secret_variant: false,
      },
    };
  }

  return {
    ok: true,
    row: {
      circle_id: input.circleId,
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      ping_type: "thinking-of-you",
      mood_emoji: null,
      secret_variant: input.secretVariant,
    },
  };
}

/** Maps a Postgres exception from the insert trigger onto an HTTP response. */
export function pingWriteFailure(
  message: string | undefined,
): { status: number; error: string } | null {
  if (!message) return null;
  const demo = demoWriteMessage(message);
  if (demo) return { status: 403, error: demo };
  if (message.includes("hsummer_rate_limited")) {
    return { status: 429, error: PING_RATE_LIMIT_MESSAGE };
  }
  if (message.includes("hsummer_couple_needs_recipient")) {
    return {
      status: 400,
      error: "Thinking of You in a couple goes to your partner.",
    };
  }
  if (
    message.includes("row-level security") ||
    message.includes("42501") ||
    message.includes("hsummer_missing_sender")
  ) {
    return { status: 403, error: "You can't send that ping." };
  }
  return null;
}
