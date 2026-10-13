/**
 * Public configuration. Safe to import from Client Components.
 *
 * These reads are written as `process.env.NEXT_PUBLIC_*` on purpose. Next.js
 * only inlines public env vars into the browser bundle when the name is a
 * static property access. `process.env[name]` stays empty in the browser.
 *
 * Server-only secrets live in `env.server.ts`.
 *
 * Supabase renamed the anon key to the publishable key and the service-role
 * key to the secret key. Both names are accepted so a key copied from the
 * current dashboard or from an older screenshot still works.
 */

const PLACEHOLDER_SNIPPETS = [
  "your-project",
  "your-publishable",
  "your-anon",
  "your-secret",
  "your-service",
  "your-vapid",
  "your-upstash",
  "your-redis",
  "you@example.com",
];

export function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return PLACEHOLDER_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

function readPublic(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || isPlaceholder(trimmed)) return null;
  return trimmed;
}

export function getSupabaseBrowserConfig(): {
  url: string;
  key: string;
} | null {
  const url = readPublic(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    readPublic(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    readPublic(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !key) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return null;
  } catch {
    return null;
  }

  return { url, key };
}

/** Public half of the VAPID key pair. The private half never reaches this file. */
export function getVapidPublicKey(): string | null {
  return readPublic(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

export function getSiteUrl(): string | null {
  const siteUrl = readPublic(process.env.NEXT_PUBLIC_SITE_URL);
  if (!siteUrl) return null;
  try {
    const parsed = new URL(siteUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
