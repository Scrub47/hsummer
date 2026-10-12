import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { getSupabaseBrowserConfig } from "@/lib/env";

/**
 * Server Supabase client for Server Components, Server Actions, and route
 * handlers. A new client is created per request because it has to read that
 * request's cookies.
 *
 * `setAll` throws when called from a Server Component (cookie writes are not
 * allowed there). The proxy refreshes the session on each request, so this
 * failure is expected and ignored. Route handlers can still write cookies.
 */
export async function createClient() {
  const config = getSupabaseBrowserConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component. The proxy owns cookie writes.
        }
      },
    },
  });
}
