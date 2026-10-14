import { createHash } from "node:crypto";

/** Magic-link sends inside 15 minutes. The next one waits. */
export const MAGIC_IP_LIMIT = 5;
export const MAGIC_EMAIL_LIMIT = 3;

/** Google sign-in starts inside 15 minutes, per IP. */
export const GOOGLE_IP_LIMIT = 10;

export const AUTH_WINDOW_MINUTES = 15;

export const AUTH_LIMIT_MESSAGE =
  "Too many sign-in tries just now. Wait a little and try again.";

export const AUTH_UNAVAILABLE =
  "Sign-in can't be rate-limited right now. Try again in a minute.";

/**
 * When Upstash allowed the try, that is the cap. When Upstash is not
 * configured, or it did not answer, Postgres is the cap. In production,
 * if neither one can decide, refuse the try. Local dev without keys can
 * still send a link.
 */
export function decideAuthLimit(input: {
  upstashEnforced: boolean;
  databaseAllowed: boolean | null;
  production: boolean;
}): { ok: true } | { ok: false; reason: "limited" | "unavailable" } {
  if (input.upstashEnforced) return { ok: true };
  if (input.databaseAllowed === true) return { ok: true };
  if (input.databaseAllowed === false) return { ok: false, reason: "limited" };
  if (input.production) return { ok: false, reason: "unavailable" };
  return { ok: true };
}

/** Bucket stored for the email. The address itself is not the Redis or SQL key. */
export function authEmailBucket(email: string): string {
  const hash = createHash("sha256")
    .update(`hsummer-auth-email-v1:${email.trim().toLowerCase()}`, "utf8")
    .digest("hex");
  return `auth:magic:email:${hash}`;
}

export function authIpBucket(kind: "magic" | "google", ipHash: string): string {
  return `auth:${kind}:ip:${ipHash}`;
}
