/**
 * Clock-offset estimate for Live Together.
 *
 * Each sample is one round trip to GET /api/time. The offset is
 * server time minus the client's time at the middle of that trip.
 * The smallest round trip wins, because a slow response is the one
 * most likely to be wrong. The shutter fires when
 * clientNow + offset >= captureAt.
 */

export type ClockSample = {
  /** Client time just before the request, in ms. */
  t0: number;
  /** Client time just after the response, in ms. */
  t1: number;
  /** Server time from the response, in ms. */
  serverNow: number;
};

export type ClockEstimate = {
  offsetMs: number;
  rttMs: number;
};

export const CLOCK_OFFSET_LIMIT_MS = 120_000;
export const CLOCK_RTT_LIMIT_MS = 30_000;

export function sampleOffset(sample: ClockSample): ClockEstimate | null {
  if (
    !Number.isFinite(sample.t0) ||
    !Number.isFinite(sample.t1) ||
    !Number.isFinite(sample.serverNow) ||
    sample.t1 < sample.t0
  ) {
    return null;
  }
  const rttMs = sample.t1 - sample.t0;
  if (rttMs > CLOCK_RTT_LIMIT_MS) return null;
  const midpoint = sample.t0 + rttMs / 2;
  const offsetMs = Math.round(sample.serverNow - midpoint);
  if (Math.abs(offsetMs) > CLOCK_OFFSET_LIMIT_MS) return null;
  return { offsetMs, rttMs };
}

/** Keeps the sample with the smallest round trip. */
export function bestClockEstimate(
  samples: readonly ClockSample[],
): ClockEstimate | null {
  let best: ClockEstimate | null = null;
  for (const sample of samples) {
    const next = sampleOffset(sample);
    if (!next) continue;
    if (!best || next.rttMs < best.rttMs) best = next;
  }
  return best;
}

/** True once the estimated server clock has reached the shared shutter. */
export function shouldCapture(input: {
  clientNow: number;
  offsetMs: number;
  captureAtMs: number;
}): boolean {
  if (
    !Number.isFinite(input.clientNow) ||
    !Number.isFinite(input.offsetMs) ||
    !Number.isFinite(input.captureAtMs)
  ) {
    return false;
  }
  return input.clientNow + input.offsetMs >= input.captureAtMs;
}

export function togetherTopic(sessionId: string): string {
  return `together:${sessionId}`;
}
