import "server-only";

import { parsePrefs, type NotificationPrefs } from "@/lib/settings/prefs";
import type { Session } from "@/lib/supabase/session";

export async function loadOwnSettings(
  session: Session,
): Promise<{ prefs: NotificationPrefs; timezone: string }> {
  const [account, profile] = await Promise.all([
    session.supabase
      .from("account_private")
      .select("notification_prefs")
      .eq("user_id", session.userId)
      .maybeSingle(),
    session.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);

  return {
    prefs: parsePrefs(account.data?.notification_prefs ?? {}),
    timezone: profile.data?.timezone ?? "UTC",
  };
}
