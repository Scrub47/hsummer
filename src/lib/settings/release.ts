import "server-only";

import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { buildPingNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowsKind, parsePrefs, quietDecision } from "@/lib/settings/prefs";

/**
 * Sends ping pushes that were held for quiet hours and are now due.
 * A row still inside the window stays held. A person who turned pings
 * off is marked delivered without a push.
 */
export async function releaseDuePings(origin: string): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  try {
    const due = await admin
      .from("held_notifications")
      .select("id, user_id, circle_id, ref_id")
      .eq("kind", "ping")
      .is("delivered_at", null)
      .lte("deliver_at", new Date().toISOString())
      .limit(40);
    if (due.error || !due.data) return 0;
    let sent = 0;
    for (const row of due.data) {
      const ok = await releaseHeldPing(admin, row, origin);
      if (ok) sent += 1;
    }
    return sent;
  } catch (error) {
    console.error(
      "Quiet-hour release failed.",
      error instanceof Error ? error.name : "error",
    );
    return 0;
  }
}

export async function releaseHeldPing(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  row: { id: string; user_id: string; circle_id: string; ref_id: string },
  origin: string,
): Promise<boolean> {
  const [account, profile, ping] = await Promise.all([
    admin
      .from("account_private")
      .select("notification_prefs")
      .eq("user_id", row.user_id)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("timezone")
      .eq("id", row.user_id)
      .maybeSingle(),
    admin
      .from("pings")
      .select("secret_variant")
      .eq("id", row.ref_id)
      .maybeSingle(),
  ]);

  const prefs = parsePrefs(account.data?.notification_prefs ?? {});
  const decision = quietDecision({
    prefs,
    timeZone: profile.data?.timezone ?? "UTC",
  });
  if (decision.inQuiet) return false;

  const circle = await admin
    .from("circles")
    .select("circle_type")
    .eq("id", row.circle_id)
    .maybeSingle();

  const shouldPush =
    allowsKind(prefs, "pings", circle.data?.circle_type ?? null) &&
    ping.data != null;

  if (shouldPush) {
    await pushHeldPing({
      userId: row.user_id,
      circleId: row.circle_id,
      origin,
      secretVariant: ping.data?.secret_variant === true,
    });
  }

  const marked = await admin
    .from("held_notifications")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("delivered_at", null);
  if (marked.error) {
    console.error("Could not mark a held ping delivered.", marked.error.code);
    return false;
  }
  return true;
}

async function pushHeldPing(input: {
  userId: string;
  circleId: string;
  origin: string;
  secretVariant: boolean;
}): Promise<void> {
  const vapid = getVapidConfig();
  const admin = createAdminClient();
  if (!vapid || !admin) return;

  const { data: rows, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.userId);
  if (error || !rows || rows.length === 0) return;

  const payload = JSON.stringify(
    buildPingNotification(input.origin, {
      secretVariant: input.secretVariant,
      circleId: input.circleId,
    }),
  );

  try {
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
    await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", input.userId)
      .in("id", staleIds);
  } catch (error) {
    console.error(
      "Held ping push threw.",
      error instanceof Error ? error.name : "error",
    );
  }
}
