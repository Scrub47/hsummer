import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { getUpstashConfig } from "@/lib/env.server";

/**
 * Shared sliding-window check used in front of the database limits.
 *
 * Upstash is optional. When `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are both set, this asks Redis first and returns
 * 429 with the caller's sentence. When they are missing, or Redis does not
 * answer, the caller continues and Postgres enforces the same cap. A direct
 * Supabase call never reaches this function, which is why the SQL triggers
 * stay.
 */

export type RateWindow = `${number} m`;

export type RateDecision =
  | { ok: true; source: "upstash" | "database" }
  | { ok: false; status: 429; error: string };

export type SharedLimiter = (input: { key: string }) => Promise<boolean>;

const TIMEOUT_MS = 1500;

const limiters = new Map<string, SharedLimiter>();

export async function enforceSharedLimit(input: {
  key: string;
  limit: number;
  window: RateWindow;
  error: string;
  /** Test double. Omit it to use Upstash when configured, or skip to Postgres. */
  limiter?: SharedLimiter | null;
}): Promise<RateDecision> {
  const limiter =
    input.limiter === undefined
      ? defaultLimiter(input.limit, input.window)
      : input.limiter;

  if (!limiter) return { ok: true, source: "database" };

  try {
    const allowed = await withTimeout(limiter({ key: input.key }), TIMEOUT_MS);
    if (!allowed) return { ok: false, status: 429, error: input.error };
    return { ok: true, source: "upstash" };
  } catch (error) {
    console.error(
      "Upstash rate limit failed; using the database limiter.",
      error instanceof Error ? error.name : "error",
    );
    return { ok: true, source: "database" };
  }
}

function defaultLimiter(
  limit: number,
  window: RateWindow,
): SharedLimiter | null {
  const config = getUpstashConfig();
  if (!config) return null;

  const cacheKey = `${limit}:${window}`;
  const cached = limiters.get(cacheKey);
  if (cached) return cached;

  const redis = new Redis({ url: config.url, token: config.token });
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `hsummer:${cacheKey}`,
    analytics: false,
  });

  const limiter: SharedLimiter = async ({ key }) => {
    const result = await ratelimit.limit(key);
    return result.success;
  };
  limiters.set(cacheKey, limiter);
  return limiter;
}

function withTimeout(pending: Promise<boolean>, ms: number): Promise<boolean> {
  // A late rejection after the timeout must not surface as unhandled.
  void pending.then(
    () => undefined,
    () => undefined,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((_, reject) => {
    timer = setTimeout(() => reject(new Error("upstash_timeout")), ms);
  });

  return Promise.race([pending, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
