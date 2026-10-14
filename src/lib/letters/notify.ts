import "server-only";

import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { deliverGroupPushes } from "@/lib/push/group-delivery";
import { buildLetterNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tells the recipient a letter arrived. The payload is the fixed sentence
 * "You have a new letter." The body, the title, and both names stay in the
 * app.
 *
 * The secret key is used only to read that person's devices and to delete
 * one the push service has retired. A missing key or a failed send does not
 * undo the letter.
 */
export async function notifyLetterRecipient(input: {
  recipientId: string;
  origin: string;
  circleId: string;
}): Promise<void> {
  try {
    const vapid = getVapidConfig();
    const admin = createAdminClient();
    if (!vapid || !admin) return;

    const circle = await admin
      .from("circles")
      .select("circle_type")
      .eq("id", input.circleId)
      .maybeSingle();
    if (circle.data && circle.data.circle_type !== "couple") {
      await deliverGroupPushes({
        circleId: input.circleId,
        userIds: [input.recipientId],
        origin: input.origin,
        specific: buildLetterNotification(input.origin, input.circleId),
      });
      return;
    }

    const { data: rows, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", input.recipientId);

    if (error || !rows || rows.length === 0) return;

    const payload = JSON.stringify(
      buildLetterNotification(input.origin, input.circleId),
    );

    const results = await deliverTestPushes(
      rows,
      payload,
      async (subscription, body) => {
        const result = await webpush.sendNotification(subscription, body, {
          vapidDetails: vapid,
          TTL: 60 * 60,
        });
        return result.statusCode;
      },
    );

    const staleIds = subscriptionsToPrune(results);
    if (staleIds.length === 0) return;

    const { error: deleteError } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", input.recipientId)
      .in("id", staleIds);
    if (deleteError) {
      console.error("Could not prune a dead device after a letter.");
    }
  } catch (error) {
    console.error(
      "Letter was saved but the push threw.",
      error instanceof Error ? error.name : "error",
    );
  }
}
