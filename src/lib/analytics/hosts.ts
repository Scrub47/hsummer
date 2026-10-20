/**
 * PostHog hosts. The browser never calls these directly. Next rewrites
 * `/ingest` to the API host, and `/ingest/static` to the asset host.
 * The key is optional. An empty or placeholder host stays on the US cloud.
 */

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** A real project key starts with phc_ and is not an example placeholder. */
export function posthogKeyConfigured(raw: string | undefined): boolean {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed.startsWith("phc_")) return false;
  const normalized = trimmed.toLowerCase();
  return !normalized.includes("your-") && !normalized.includes("your_");
}

export function posthogApiHost(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase().includes("your-")) {
    return DEFAULT_POSTHOG_HOST;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return DEFAULT_POSTHOG_HOST;
    return url.origin;
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}

/** us.i.posthog.com → us-assets.i.posthog.com. A custom host stays as-is. */
export function posthogAssetHost(apiHost: string): string {
  return apiHost.replace(
    /^(https:\/\/)([a-z0-9-]+)(\.i\.posthog\.com)$/i,
    "$1$2-assets$3",
  );
}

/** us.i.posthog.com → us.posthog.com. Used only for links inside PostHog. */
export function posthogUiHost(apiHost: string): string {
  return apiHost.replace(".i.posthog.com", ".posthog.com");
}

export function posthogRewrites(rawHost: string | undefined): {
  source: string;
  destination: string;
}[] {
  const api = posthogApiHost(rawHost);
  const assets = posthogAssetHost(api);
  return [
    {
      source: "/ingest/static/:path*",
      destination: `${assets}/static/:path*`,
    },
    {
      source: "/ingest/:path*",
      destination: `${api}/:path*`,
    },
  ];
}
