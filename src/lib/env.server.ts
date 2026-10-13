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
 * and the ping insert run as the signed-in user, so RLS applies. Thinking of
 * You uses the key for one thing: read the recipient's push subscriptions and
 * delete a device the push service has retired. Scheduled letter delivery is
 * the next planned caller.
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
