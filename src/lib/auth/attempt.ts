import "server-only";

import {
  AUTH_LIMIT_MESSAGE,
  AUTH_UNAVAILABLE,
  AUTH_WINDOW_MINUTES,
  decideAuthLimit,
} from "@/lib/auth/limit";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Upstash first, then the private.auth_attempts counter. A direct call to
 * Supabase Auth does not pass through here. Captcha on the Supabase project
 * is what covers that path. See SECURITY_AUDIT.md.
 */
export async function enforceAuthLimits(
  buckets: { key: string; limit: number }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const production = process.env.NODE_ENV === "production";

  for (const bucket of buckets) {
    const shared = await enforceSharedLimit({
      key: bucket.key,
      limit: bucket.limit,
      window: `${AUTH_WINDOW_MINUTES} m`,
      error: AUTH_LIMIT_MESSAGE,
    });
    if (!shared.ok) return { ok: false, error: AUTH_LIMIT_MESSAGE };
    if (shared.source === "upstash") continue;

    const allowed = await consumeAuthBucket({
      bucket: bucket.key,
      limit: bucket.limit,
      windowSeconds: AUTH_WINDOW_MINUTES * 60,
    });
    const decision = decideAuthLimit({
      upstashEnforced: false,
      databaseAllowed: allowed,
      production,
    });
    if (!decision.ok) {
      return {
        ok: false,
        error:
          decision.reason === "limited" ? AUTH_LIMIT_MESSAGE : AUTH_UNAVAILABLE,
      };
    }
  }

  return { ok: true };
}

/**
 * One row in private.auth_attempts, via the service role. Returns null when
 * the secret key is missing or the call failed, so the caller can decide
 * whether to fail open. The function is not granted to anon or authenticated,
 * so the public Data API cannot increment the counter or read it.
 */
export async function consumeAuthBucket(input: {
  bucket: string;
  limit: number;
  windowSeconds: number;
}): Promise<boolean | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.rpc("consume_auth_attempt", {
    attempt_bucket: input.bucket,
    attempt_limit: input.limit,
    attempt_window: input.windowSeconds,
  });

  if (error || typeof data !== "boolean") {
    console.error("Auth rate limit could not be recorded.");
    return null;
  }
  return data;
}
