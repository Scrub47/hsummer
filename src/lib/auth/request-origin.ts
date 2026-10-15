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
/**
 * Origin for a server action that starts Google or a magic link.
 *
 * A loopback Host is the browser. Any other Host is the host this deployment
 * answered on (Vercel sets it). x-forwarded-host is ignored so a caller cannot
 * point the callback at a different site.
 */
export function actionOrigin(headerList: {
  get(name: string): string | null;
}): string {
  const loopback = loopbackOrigin(headerList.get("host"));
  if (loopback) return loopback;

  const host = headerList.get("host")?.trim() ?? "";
  if (!host || host.includes(",") || /\s/.test(host)) {
    return getSiteUrl() ?? "http://localhost:3000";
  }

  const forwarded = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwarded === "http" || forwarded === "https" ? forwarded : "https";

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return getSiteUrl() ?? "http://localhost:3000";
  }
}

/**
 * True for a form or fetch that started on this app. A cross-site POST is
 * refused so another website cannot switch the browser into the demo session.
 */
export function isSameOriginPost(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-origin";
  return origin === actionOrigin(request.headers);
}

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
