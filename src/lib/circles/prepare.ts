import "server-only";

import { notifyCheckpoint } from "@/lib/countdowns/notify";
import { notifyLetterRecipient } from "@/lib/letters/notify";
import type { Session } from "@/lib/supabase/session";

/**
 * Opening the app. Auto checkpoints whose date has arrived are hit once,
 * and a scheduled letter whose time has passed is delivered if QStash has
 * not already done it. Both calls are safe to repeat.
 */
export async function prepareCircle(
  session: Session,
  circleId: string,
  origin: string,
): Promise<void> {
  const [synced, delivered, members] = await Promise.all([
    session.supabase.rpc("sync_auto_checkpoints", { target_circle: circleId }),
    session.supabase.rpc("deliver_due_letters", { target_circle: circleId }),
    session.supabase
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .is("left_at", null),
  ]);

  if (
    synced.error &&
    !isMissingMigration(synced.error.message, synced.error.code)
  ) {
    console.error("Checkpoint sync failed.", synced.error.code);
  }
  if (
    delivered.error &&
    !isMissingMigration(delivered.error.message, delivered.error.code)
  ) {
    console.error("Due letters failed.", delivered.error.code);
  }

  const fresh = synced.data ?? [];
  if (fresh.length > 0) {
    const others = (members.data ?? [])
      .map((row) => row.user_id)
      .filter((id) => id !== session.userId);
    await notifyCheckpoint({ userIds: others, origin, circleId });
  }

  for (const row of delivered.data ?? []) {
    if (!row.to_user_id) continue;
    await notifyLetterRecipient({
      recipientId: row.to_user_id,
      origin,
      circleId,
    });
  }
}

function isMissingMigration(
  message: string | undefined,
  code: string | undefined,
): boolean {
  if (code === "PGRST202" || code === "PGRST205" || code === "42883") {
    return true;
  }
  return (
    Boolean(message?.includes("sync_auto_checkpoints")) ||
    Boolean(message?.includes("deliver_due_letters"))
  );
}
