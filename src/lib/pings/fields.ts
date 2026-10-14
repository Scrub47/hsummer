/**
 * Thinking of You rules shared by the route, the button, and the unit tests.
 *
 * The database is the backstop. This module rejects the same shapes before a
 * request, and it is where the rate-limit numbers live so the tests can name
 * them. The week 4 insert trigger enforces those numbers. Week 5 checks the
 * same cap in the route (and in Upstash, when that is configured) and still
 * leaves the trigger in place, so a direct insert cannot skip it.
 *
 * A whole-circle ping (to_user_id null) is a real row shape. The app does not
 * send one until group UX. BROADCAST_PINGS_ENABLED is that flag.
 *
 * A shared mood is the same insert with ping_type mood-share. The public
 * POST route still refuses a mood field. The circle page builds that row
 * only when the share box is checked.
 */

import { isMoodEmoji, type MoodEmoji } from "@/lib/moods/fields";

export const BROADCAST_PINGS_ENABLED = false;

/** Successful sends inside the window. The 11th is refused. */
export const PING_LIMIT = 10;
export const PING_WINDOW_MINUTES = 10;

export const PING_RATE_LIMIT_MESSAGE =
  "You've sent a few of these just now. Wait a little and try again.";

export const PING_BROADCAST_ERROR =
  "Thinking of You goes to your partner. Whole-circle pings aren't available yet.";

const CIRCLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartnerResolution =
  | { ok: true; partnerId: string }
  | {
      ok: false;
      reason:
        "archived" | "not_couple" | "pending" | "no_partner" | "ambiguous";
    };

type Parsed =
  | { ok: true; circleId: string; secretVariant: boolean }
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
 * Body of POST /api/pings. A couple omits the recipient. Passing toUserId is
 * refused while broadcast pings are flagged off, so this route cannot be used
 * as a picker.
 */
export function parsePingRequest(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Send a circle id." };
  }

  const record = body as Record<string, unknown>;
  if (
    "toUserId" in record ||
    "to_user_id" in record ||
    "pingType" in record ||
    "type" in record ||
    "moodEmoji" in record ||
    "mood_emoji" in record
  ) {
    return { ok: false, status: 400, error: PING_BROADCAST_ERROR };
  }

  const circleId = record.circleId;
  if (typeof circleId !== "string" || !CIRCLE_ID_PATTERN.test(circleId)) {
    return { ok: false, status: 400, error: "That circle isn't available." };
  }

  if ("secretVariant" in record && typeof record.secretVariant !== "boolean") {
    return { ok: false, status: 400, error: "That ping isn't valid." };
  }

  return {
    ok: true,
    circleId,
    secretVariant: record.secretVariant === true,
  };
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
        error:
          "Thinking of You goes to your partner. Group pings aren't available yet.",
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
  to_user_id: string;
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
  toUserId: string;
  secretVariant: boolean;
  moodEmoji: string | null;
}): { ok: true; row: CirclePingRow } | { ok: false; error: string } {
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
