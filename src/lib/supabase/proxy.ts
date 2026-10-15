import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { redirectOrigin } from "@/lib/auth/request-origin";
import { safeNextPath } from "@/lib/auth/safe-next";
import type { Database } from "@/lib/database.types";
import { getSupabaseBrowserConfig, getTurnstileSiteKey } from "@/lib/env";
import {
  applyDocumentSecurity,
  buildContentSecurityPolicy,
  createNonce,
  isHttpsRequest,
} from "@/lib/security/headers";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";

const PROTECTED_PREFIXES = ["/home", "/profile", "/circles"];

function signInRedirect(request: NextRequest): URL {
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return new URL(
    `/sign-in?next=${encodeURIComponent(next)}`,
    redirectOrigin(request),
  );
}

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
 * Refreshes the Supabase session cookie and redirects signed-out visitors
 * away from home and profile.
 *
 * This is not the authorization check. Pages and route handlers call
 * `getClaims()` themselves. The proxy's job is to refresh an expiring token
 * before Server Components run, because they cannot write cookies.
 *
 * Do not put any other work between `createServerClient` and `getClaims()`.
 * A second refresh in between can invalidate the token and sign people out.
 */
export async function updateSession(request: NextRequest) {
  const https = isHttpsRequest(request);
  const nonce = createNonce();
  const supabaseOrigin = supabaseOriginFromEnv();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseOrigin,
    turnstile: getTurnstileSiteKey() !== null,
    development: process.env.NODE_ENV === "development",
    https,
  });
  // Next reads this header while rendering and stamps the nonce on its scripts.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  const finish = (response: NextResponse) => {
    applyDocumentSecurity(response.headers, { csp, https });
    return response;
  };

  const config = getSupabaseBrowserConfig();
  if (!config) {
    if (isProtectedPage(request.nextUrl.pathname)) {
      return finish(NextResponse.redirect(signInRedirect(request)));
    }
    return finish(NextResponse.next({ request }));
  }

  let supabaseResponse = NextResponse.next({ request });

  // Fluid Compute reuses isolates. Never store this client in a global.
  const supabase = createServerClient<Database>(config.url, config.key, {
    cookieOptions: supabaseCookieOptions(https),
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
    return finish(NextResponse.next({ request }));
  }

  const pathname = request.nextUrl.pathname;

  if (!userId && isProtectedPage(pathname)) {
    const redirect = NextResponse.redirect(signInRedirect(request));
    return finish(copySessionHeaders(supabaseResponse, redirect));
  }

  if (userId && isProtectedPage(pathname)) {
    const age = await readAgeConfirmed(supabase, userId);
    if (age === false) {
      const next = `${pathname}${request.nextUrl.search}`;
      const redirect = NextResponse.redirect(
        new URL(
          `/confirm-age?next=${encodeURIComponent(next)}`,
          redirectOrigin(request),
        ),
      );
      return finish(copySessionHeaders(supabaseResponse, redirect));
    }
  }

  if (userId && pathname === "/sign-in") {
    const nextPath = safeNextPath(
      request.nextUrl.searchParams.get("next"),
      request.nextUrl.origin,
    );
    const redirect = NextResponse.redirect(
      new URL(nextPath, redirectOrigin(request)),
    );
    return finish(copySessionHeaders(supabaseResponse, redirect));
  }

  return finish(supabaseResponse);
}

/**
 * False only when the row exists and the 13+ column is still null.
 * A missing row or a query error leaves the person through, so an
 * unapplied migration does not lock every page.
 */
async function readAgeConfirmed(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("account_private")
      .select("age_confirmed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data.age_confirmed_at !== null;
  } catch {
    return null;
  }
}

function supabaseOriginFromEnv(): string | null {
  const config = getSupabaseBrowserConfig();
  if (!config) return null;
  try {
    return new URL(config.url).origin;
  } catch {
    return null;
  }
}
