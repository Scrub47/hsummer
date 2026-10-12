import { NextResponse } from "next/server";
import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { buildTestNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { getSession } from "@/lib/supabase/session";

/**
 * Sends a generic test notification to every device saved for the caller,
 * then deletes subscriptions the push service says are gone (404 or 410).
 *
 * POST, not GET: a GET would run from a prefetch or an embedded image and
 * could buzz the phone. The body is ignored. The payload is built here and
 * contains no profile or Circle data.
 *
 * This route uses the Node.js runtime (the default). `web-push` needs Node
 * crypto, so it must not be moved to the Edge runtime.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { supabase, userId } = session;

  const vapid = getVapidConfig();
  if (!vapid) {
    return NextResponse.json(
      { error: "VAPID keys are not configured yet." },
      { status: 503 },
    );
  }

  const { data: rows, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !rows) {
    console.error("Could not load push subscriptions.");
    return NextResponse.json(
      { error: "Could not load devices." },
      { status: 500 },
    );
  }

  const origin = new URL(request.url).origin;
  const payload = JSON.stringify(buildTestNotification(origin));

  const results = await deliverTestPushes(
    rows,
    payload,
    async (subscription, body) => {
      const result = await webpush.sendNotification(subscription, body, {
        vapidDetails: vapid,
        TTL: 60,
      });
      return result.statusCode;
    },
  );

  const staleIds = subscriptionsToPrune(results);
  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("push_subscriptions")
      .delete()
      .in("id", staleIds);
    if (deleteError) {
      console.error("Could not prune dead push subscriptions.");
    }
  }

  const sent = results.filter(
    (result) =>
      result.statusCode !== null &&
      result.statusCode >= 200 &&
      result.statusCode < 300,
  ).length;

  return NextResponse.json({
    devices: rows.length,
    sent,
    removed: staleIds.length,
    failed: results.length - sent - staleIds.length,
  });
}
