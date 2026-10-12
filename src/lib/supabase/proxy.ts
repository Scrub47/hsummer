import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { getSupabaseBrowserConfig } from "@/lib/env";

const PROTECTED_PREFIXES = ["/home"];

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function copySessionHeaders(
  from: NextResponse,
  to: NextResponse,
): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
  // These stop a CDN from caching a response that just set an auth cookie.
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) to.headers.set(header, value);
  }
  return to;
}

/**
 * Refreshes the Supabase session cookie and redirects the signed-out home page.
 *
 * This is not the authorization check. Pages and route handlers call
 * `getClaims()` themselves. The proxy's job is to refresh an expiring token
 * before Server Components run, because they cannot write cookies.
 *
 * Do not put any other work between `createServerClient` and `getClaims()`.
 * A second refresh in between can invalidate the token and sign people out.
 */
export async function updateSession(request: NextRequest) {
  const config = getSupabaseBrowserConfig();
  if (!config) {
    if (isProtectedPage(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // Fluid Compute reuses isolates. Never store this client in a global.
  const supabase = createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && typeof data?.claims.sub === "string") {
      userId = data.claims.sub;
    }
  } catch {
    // A missing project or a bad key should not take down the public pages.
    console.error("Supabase session refresh failed.");
    return NextResponse.next({ request });
  }

  const pathname = request.nextUrl.pathname;

  if (!userId && isProtectedPage(pathname)) {
    const redirect = NextResponse.redirect(new URL("/sign-in", request.url));
    return copySessionHeaders(supabaseResponse, redirect);
  }

  if (userId && pathname === "/sign-in") {
    const redirect = NextResponse.redirect(new URL("/home", request.url));
    return copySessionHeaders(supabaseResponse, redirect);
  }

  return supabaseResponse;
}
