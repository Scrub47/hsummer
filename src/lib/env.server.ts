import "server-only";

import { isPlaceholder } from "@/lib/env";

/**
 * Secrets. Import this only from Server Components, route handlers, and proxy.
 * `server-only` makes a Client Component import fail the build.
 *
 * Read inside a request, not at module scope. On a dynamic route Next.js
 * evaluates these at runtime, so a value set in the host (Vercel) is visible
 * without baking it into a static page.
 *
 * The secret key bypasses row level security. Profile edits, the test push,
 * the ping insert, and the letter insert run as the signed-in user, so RLS
 * applies. Thinking of You and a new letter use the key for one thing: read
 * the recipient's push subscriptions and delete a device the push service has
 * retired. The QStash callback uses it to deliver a scheduled letter. Redis
 * rate limits are separate and stay in us-west-2. QStash itself is global.
 */

function readSecret(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || isPlaceholder(trimmed)) return null;
  return trimmed;
}

export function getSupabaseSecretKey(): string | null {
  return (
    readSecret(process.env.SUPABASE_SECRET_KEY) ??
    readSecret(process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export type VapidConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

export function getVapidConfig(): VapidConfig | null {
  const subject = readSecret(process.env.VAPID_SUBJECT);
  const publicKey = readSecret(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = readSecret(process.env.VAPID_PRIVATE_KEY);

  if (!subject || !publicKey || !privateKey) return null;
  // web-push rejects anything that is not a mailto: or https: contact.
  if (!subject.startsWith("mailto:") && !subject.startsWith("https:"))
    return null;

  return { subject, publicKey, privateKey };
}

/**
 * Optional Upstash Redis REST credentials for sliding-window rate limits.
 * Both must be set. When either is missing, or still a placeholder, rate
 * limits stay in Postgres. Nothing else in the app reads these.
 */
export function getUpstashConfig(): { url: string; token: string } | null {
  const url = readSecret(process.env.UPSTASH_REDIS_REST_URL);
  const token = readSecret(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { url, token };
}

/**
 * Cloudflare Turnstile secret. Server only. When the public site key is set,
 * Google sign-in checks the widget token with this secret, because Supabase
 * Auth does not run captcha on the OAuth `/authorize` redirect. Magic link
 * sends the token to Supabase instead, and the dashboard holds the same
 * secret. A Turnstile token is single-use, so this app must not check it
 * and also send it to Supabase.
 */
export function getTurnstileSecret(): string | null {
  return readSecret(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Upstash QStash. All three must be set. QStash has no region; the token and
 * both signing keys come from the QStash page in the Upstash console.
 * When any one is missing, scheduled letters stay in the database and are
 * delivered the next time someone in the circle opens the app after the time.
 */
export function getQstashConfig(): {
  token: string;
  currentSigningKey: string;
  nextSigningKey: string;
} | null {
  const token = readSecret(process.env.QSTASH_TOKEN);
  const currentSigningKey = readSecret(process.env.QSTASH_CURRENT_SIGNING_KEY);
  const nextSigningKey = readSecret(process.env.QSTASH_NEXT_SIGNING_KEY);
  if (!token || !currentSigningKey || !nextSigningKey) return null;
  if (
    token.length < 8 ||
    currentSigningKey.length < 8 ||
    nextSigningKey.length < 8
  ) {
    return null;
  }
  return { token, currentSigningKey, nextSigningKey };
}
