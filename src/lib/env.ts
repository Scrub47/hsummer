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

import { posthogApiHost, posthogKeyConfigured } from "@/lib/analytics/hosts";

const PLACEHOLDER_SNIPPETS = [
  "your-project",
  "your-publishable",
  "your-anon",
  "your-secret",
  "your-service",
  "your-vapid",
  "your-upstash",
  "your-qstash",
  "your-redis",
  "your-turnstile",
  "your-posthog",
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

/**
 * True for a secret key pasted into a public variable: the sb_secret_ prefix,
 * or a JWT whose payload role is service_role. The signature is not checked.
 * This only stops the app from shipping that key to the browser.
 */
export function isSecretSupabaseKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("sb_secret_")) return true;
  return jwtRole(trimmed) === "service_role";
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const payload: unknown = JSON.parse(atob(padded + pad));
    if (!payload || typeof payload !== "object" || !("role" in payload)) {
      return null;
    }
    const role = (payload as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
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
  if (isSecretSupabaseKey(key)) {
    console.error(
      "Refusing a secret Supabase key in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
    return null;
  }

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

/**
 * Cloudflare Turnstile site key. Public by design. When this is set, the
 * sign-in form asks for a token and Supabase checks it — but only after
 * captcha is enabled on the Supabase project with the matching secret.
 * Absent or still the example placeholder: the widget stays off.
 */
export function getTurnstileSiteKey(): string | null {
  return readPublic(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

/**
 * PostHog project key. Public by design. When this is empty or still the
 * example placeholder, the library is not loaded and nothing is sent.
 * The host defaults to the US ingestion endpoint. The browser talks to
 * `/ingest` on this app, which Next rewrites to that host.
 */
export function getPostHogPublicConfig(): { key: string; host: string } | null {
  const key = readPublic(process.env.NEXT_PUBLIC_POSTHOG_KEY);
  if (!key || !posthogKeyConfigured(key)) return null;
  return {
    key,
    host: posthogApiHost(process.env.NEXT_PUBLIC_POSTHOG_HOST),
  };
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
