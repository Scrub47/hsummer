"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Browser Supabase client. `createBrowserClient` keeps a singleton, so calling
 * this more than once does not open extra connections.
 *
 * Returns null when the public env vars are missing or still the placeholders
 * from `.env.example`, so the sign-in page can render without a project.
 */
export function createClient() {
  const config = getSupabaseBrowserConfig();
  if (!config) return null;

  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:";

  return createBrowserClient<Database>(config.url, config.key, {
    cookieOptions: supabaseCookieOptions(secure),
  });
}
