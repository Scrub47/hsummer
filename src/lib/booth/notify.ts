import "server-only";

import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { buildPassNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tells the partner it is their turn. The payload is the fixed sentence
 * "It's your turn in the photo booth." Names, captions, and photos stay
 * in the app.
 *
 * The secret key is used only to read that person's devices and to delete
 * one the push service has retired. A missing key or a failed send does not
 * undo the booth.
 */
export async function notifyPassPartner(input: {
  partnerId: string;
  origin: string;
  circleId: string;
}): Promise<void> {
  try {
    const vapid = getVapidConfig();
    const admin = createAdminClient();
    if (!vapid || !admin) return;

    const { data: rows, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", input.partnerId);

    if (error || !rows || rows.length === 0) return;

    const payload = JSON.stringify(
      buildPassNotification(input.origin, input.circleId),
    );

    const results = await deliverTestPushes(
      rows,
      payload,
      async (subscription, body) => {
        const result = await webpush.sendNotification(subscription, body, {
          vapidDetails: vapid,
          TTL: 60 * 60 * 24 * 7,
        });
        return result.statusCode;
      },
    );

    const staleIds = subscriptionsToPrune(results);
    if (staleIds.length === 0) return;

    const { error: deleteError } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", input.partnerId)
      .in("id", staleIds);
    if (deleteError) {
      console.error("Could not prune a dead device after a booth.");
    }
  } catch (error) {
    console.error(
      "The booth was saved but the push threw.",
      error instanceof Error ? error.name : "error",
    );
  }
}
