/** Where to send someone after a successful sign-in. */
export const DEFAULT_NEXT_PATH = "/home";

/**
 * Auth redirects carry a `next` query param. Only same-origin paths are
 * allowed, so a crafted link cannot send the browser to another site
 * after the session cookie is set.
 */
export function safeNextPath(value: string | null, origin: string): string {
  if (!value) return DEFAULT_NEXT_PATH;

  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return DEFAULT_NEXT_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_NEXT_PATH;
  }
}
