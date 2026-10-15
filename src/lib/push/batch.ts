/**
 * Group notification batching.
 *
 * A couple is never passed here. Their pushes go out one at a time, the
 * way they did before group circles.
 *
 * In a group, the first push in a minute is sent. Further ones in that
 * minute are held. The next event after the minute sends one generic
 * "you have new updates" push instead of buzzing for each held event.
 * A muted membership sends nothing.
 */

export const GROUP_PUSH_WINDOW_MS = 60_000;

/** Far-future mute used by "until I turn this off". */
export const MUTE_UNTIL_OFF = "9999-12-31T00:00:00.000Z";

export type PushDecision = "send" | "digest" | "hold" | "muted";

export function decideGroupPush(input: {
  mutedUntil: string | null;
  nowMs: number;
  lastSentAtMs: number | null;
  heldCount: number;
}): { decision: PushDecision; nextHeld: number; stampSent: boolean } {
  if (isMuted(input.mutedUntil, input.nowMs)) {
    return { decision: "muted", nextHeld: input.heldCount, stampSent: false };
  }

  const held =
    Number.isInteger(input.heldCount) && input.heldCount > 0
      ? input.heldCount
      : 0;
  const recent =
    input.lastSentAtMs !== null &&
    input.nowMs - input.lastSentAtMs < GROUP_PUSH_WINDOW_MS &&
    input.nowMs >= input.lastSentAtMs;

  if (recent) {
    return { decision: "hold", nextHeld: held + 1, stampSent: false };
  }
  if (held > 0) {
    return { decision: "digest", nextHeld: 0, stampSent: true };
  }
  return { decision: "send", nextHeld: 0, stampSent: true };
}

export function isMuted(mutedUntil: string | null, nowMs: number): boolean {
  if (!mutedUntil) return false;
  const until = Date.parse(mutedUntil);
  return Number.isFinite(until) && until > nowMs;
}

export function muteUntilFromChoice(
  choice: string,
  now: Date,
): string | null | undefined {
  if (choice === "off") return null;
  if (choice === "until-off") return MUTE_UNTIL_OFF;
  if (choice === "hour")
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (choice === "day") {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

export function currentMuteStatus(mutedUntil: string | null): string | null {
  return muteStatus(mutedUntil, Date.now());
}

export function muteStatus(
  mutedUntil: string | null,
  nowMs: number,
): string | null {
  if (!isMuted(mutedUntil, nowMs) || !mutedUntil) return null;
  if (mutedUntil.startsWith("9999")) {
    return "Notifications from this circle are off until you turn them back on.";
  }
  const until = new Date(mutedUntil);
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(until);
  return `Notifications from this circle are quiet until ${when}.`;
}
