/**
 * The Playwright sign-in route is allowed only against a local Supabase API.
 *
 * Production and preview URLs are https on `*.supabase.co`. Local `supabase
 * start` serves the API over plain http on localhost or 127.0.0.1. Both checks
 * have to pass: the E2E_TEST_AUTH flag, and this URL shape. Setting the flag
 * on Vercel does not open the route, because the hosted URL fails this test.
 */

// Node's URL.hostname keeps the brackets on an IPv6 address (`[::1]`).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalSupabaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (url.search || url.hash) return false;
  return LOCAL_HOSTS.has(url.hostname);
}

export function testSignInAllowed(input: {
  flag: string | undefined;
  supabaseUrl: string | null;
}): boolean {
  return (
    input.flag === "1" &&
    typeof input.supabaseUrl === "string" &&
    isLocalSupabaseUrl(input.supabaseUrl)
  );
}
