import { getSiteUrl } from "@/lib/env";

/**
 * Origin to use when this app redirects the browser.
 *
 * Next builds `request.url` from the server's own hostname. That hostname is
 * `localhost` even when the browser opened `http://127.0.0.1:3000`. Those two
 * names do not share cookies, so a redirect to `request.url` signs the
 * browser out of the page it actually has open.
 *
 * A loopback `Host` header is the browser's origin, and it is safe to follow:
 * it cannot point at another site. Every other host, including production,
 * keeps the origin from `request.url`.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function redirectOrigin(request: {
  url: string;
  headers: { get(name: string): string | null };
}): string {
  const fromHost = loopbackOrigin(request.headers.get("host"));
  if (fromHost) return fromHost;
  return new URL(request.url).origin;
}

/**
 * Origin to put in a push click-through.
 *
 * A loopback Host is the browser this action is serving. Any other Host is
 * ignored, so a forwarded header cannot point the notification at another
 * site. Production uses NEXT_PUBLIC_SITE_URL.
 */
export function pushOrigin(headerList: {
  get(name: string): string | null;
}): string {
  const loopback = loopbackOrigin(headerList.get("host"));
  if (loopback) return loopback;
  return getSiteUrl() ?? "http://localhost:3000";
}

function loopbackOrigin(host: string | null): string | null {
  if (!host) return null;
  const trimmed = host.trim();
  if (!trimmed || trimmed.includes(",") || /\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(`http://${trimmed}`);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  return url.origin;
}
