import "server-only";

import {
  deleteLetterMessage,
  isQstashMessageId,
  publicDeliverUrl,
  publishLetterMessage,
} from "@/lib/schedule/qstash";
import { getQstashConfig } from "@/lib/env.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Asks QStash to call /api/letters/deliver at the stored instant, then saves
 * the message id so a later edit can cancel it.
 *
 * Missing keys, a local origin, or a failed publish all return "waiting".
 * The letter is already scheduled. Opening the app after that time delivers it.
 */
export async function queueLetterDelivery(input: {
  letterId: string;
  scheduledFor: string;
  origin: string;
}): Promise<"queued" | "waiting"> {
  const callback = publicDeliverUrl(input.origin);
  const admin = createAdminClient();
  if (!callback || !admin || !getQstashConfig()) return "waiting";

  const when = new Date(input.scheduledFor);
  if (Number.isNaN(when.getTime())) return "waiting";

  try {
    const messageId = await publishLetterMessage({
      letterId: input.letterId,
      notBefore: Math.floor(when.getTime() / 1000),
      callbackUrl: callback,
    });
    if (!messageId || !isQstashMessageId(messageId)) {
      if (messageId) await deleteLetterMessage(messageId);
      return "waiting";
    }

    const stored = await admin
      .from("letters")
      .update({ qstash_message_id: messageId })
      .eq("id", input.letterId)
      .eq("status", "scheduled")
      .select("id");

    if (stored.error || !stored.data || stored.data.length === 0) {
      console.error("Could not store the QStash message id.");
      await deleteLetterMessage(messageId);
      return "waiting";
    }

    return "queued";
  } catch (error) {
    console.error(
      "QStash publish failed.",
      error instanceof Error ? error.name : "error",
    );
    return "waiting";
  }
}

export async function cancelQueuedLetter(letterId: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  const row = await admin
    .from("letters")
    .select("qstash_message_id")
    .eq("id", letterId)
    .maybeSingle();

  const messageId = row.data?.qstash_message_id;
  if (typeof messageId !== "string") return;
  await deleteLetterMessage(messageId);
}
