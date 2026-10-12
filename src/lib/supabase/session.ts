import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type Session = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

/**
 * Verified session for a server request, or null when nobody is signed in
 * (including when Supabase env vars are still placeholders).
 *
 * `getClaims()` checks the JWT signature. Do not use `getSession()` for this:
 * it trusts the cookie without verifying it.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims.sub !== "string") return null;
  return { supabase, userId: data.claims.sub };
}

export async function getUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.userId ?? null;
}
