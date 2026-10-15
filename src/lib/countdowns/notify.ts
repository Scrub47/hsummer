import "server-only";

import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { deliverGroupPushes } from "@/lib/push/group-delivery";
import { buildCheckpointNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tells the other people in the circle that a checkpoint was hit.
 * The payload does not include the label. A missing key does not undo the hit.
 */
export async function notifyCheckpoint(input: {
  userIds: readonly string[];
  origin: string;
  circleId: string;
}): Promise<void> {
  const ids = [...new Set(input.userIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return;

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
        userIds: ids,
        origin: input.origin,
        specific: buildCheckpointNotification(input.origin, input.circleId),
      });
      return;
    }

    const { data: rows, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", ids);

    if (error || !rows || rows.length === 0) return;

    const payload = JSON.stringify(
      buildCheckpointNotification(input.origin, input.circleId),
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
      .in("id", staleIds);
    if (deleteError) {
      console.error("Could not prune a dead device after a checkpoint.");
    }
  } catch (error) {
    console.error(
      "Checkpoint was saved but the push threw.",
      error instanceof Error ? error.name : "error",
    );
  }
}
