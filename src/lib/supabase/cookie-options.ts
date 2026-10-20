import type { CookieOptions } from "@supabase/ssr";

/**
 * Session cookie flags.
 *
 * HttpOnly stays off. @supabase/ssr keeps the access token, the refresh
 * token, and the PKCE verifier in cookies that the browser client reads
 * through document.cookie. Realtime uses that access token. An HttpOnly
 * cookie would be invisible to that client and sign-in would not stick.
 *
 * Secure is on only for an https request. A production `next start` on
 * http://127.0.0.1 (the local Playwright job) must still be able to store
 * the cookie. Vercel sends x-forwarded-proto: https, so the hosted app
 * sets Secure.
 *
 * SameSite=Lax is the library default. It is set here so a later upgrade
 * cannot drop it. Lax sends the cookie on top-level navigations (the magic
 * link and the Google return) and withholds it from cross-site POSTs.
 */
export function supabaseCookieOptions(
  secure: boolean,
  embed = false,
): CookieOptions {
  if (embed && secure) {
    return {
      path: "/",
      sameSite: "none",
      secure: true,
      httpOnly: false,
      partitioned: true,
    };
  }
  return {
    path: "/",
    sameSite: "lax",
    secure,
    httpOnly: false,
  };
}
