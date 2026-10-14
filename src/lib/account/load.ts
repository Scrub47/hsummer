import "server-only";

import type { Session } from "@/lib/supabase/session";

/**
 * Reads the owner-only flag for the signed-in account. A missing column or a
 * missing row is treated as a normal account so an unapplied migration does
 * not lock the app.
 */
export async function loadAccountFlags(
  session: Session,
): Promise<{ isDemo: boolean }> {
  const { data, error } = await session.supabase
    .from("account_private")
    .select("is_demo")
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error || !data) return { isDemo: false };
  return { isDemo: data.is_demo === true };
}
