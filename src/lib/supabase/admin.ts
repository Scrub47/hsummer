import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { getSupabaseSecretKey } from "@/lib/env.server";

/**
 * Service-role client. It bypasses row level security.
 *
 * Thinking of You uses it for one job: read the recipient's push subscriptions
 * and delete a row the push service has retired. The ping itself is inserted
 * with the signed-in user's client, so the pings policies still apply.
 *
 * Never import this from a Client Component. `server-only` fails that build.
 */
export function createAdminClient() {
  const config = getSupabaseBrowserConfig();
  const key = getSupabaseSecretKey();
  if (!config || !key) return null;

  return createClient<Database>(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
