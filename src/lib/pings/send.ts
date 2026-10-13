import "server-only";

import { revalidatePath } from "next/cache";
import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import {
  PING_LIMIT,
  PING_RATE_LIMIT_MESSAGE,
  PING_WINDOW_MINUTES,
  partnerReasonMessage,
  pingSendAllowed,
  pingWriteFailure,
  resolveCouplePartner,
} from "@/lib/pings/fields";
import { buildPingNotification } from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Session } from "@/lib/supabase/session";

export type PingSendResponse = {
  status: number;
  body:
    | { error: string }
    | {
        ok: true;
        pingId: string;
        secretVariant: boolean;
        devices: number;
        sent: number;
        removed: number;
        push: "sent" | "unconfigured" | "none" | "failed";
      };
};

const UNAVAILABLE =
  "Thinking of You isn't available yet. Apply the week 4 SQL in the Supabase SQL editor, then try again.";

/**
 * Inserts one Thinking of You for the partner in an active couple, then pushes
 * it to every device saved for that person.
 *
 * The insert uses the caller's session, so RLS decides whether the row is
 * allowed. The secret key is used only afterwards, to reach devices the caller
 * is not allowed to read.
 */
export async function sendThinkingOfYou(
  session: Session,
  input: { circleId: string; secretVariant: boolean; origin: string },
): Promise<PingSendResponse> {
  const circle = await session.supabase
    .from("circles")
    .select("id, circle_type, status")
    .eq("id", input.circleId)
    .maybeSingle();

  if (circle.error) {
    console.error("Ping circle lookup failed.", circle.error.code);
    return { status: 503, body: { error: UNAVAILABLE } };
  }
  if (!circle.data) {
    return { status: 404, body: { error: "That circle isn't available." } };
  }

  const since = new Date(
    Date.now() - PING_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const [members, recent] = await Promise.all([
    session.supabase
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", input.circleId)
      .is("left_at", null),
    session.supabase
      .from("pings")
      .select("id")
      .eq("from_user_id", session.userId)
      .gt("sent_at", since)
      .limit(PING_LIMIT),
  ]);

  if (members.error || recent.error) {
    console.error("Ping membership lookup failed.");
    return { status: 503, body: { error: UNAVAILABLE } };
  }

  const partner = resolveCouplePartner({
    selfId: session.userId,
    circleType: circle.data.circle_type,
    status: circle.data.status,
    activeMemberIds: (members.data ?? []).map((row) => row.user_id),
  });
  if (!partner.ok) {
    const failure = partnerReasonMessage(partner.reason);
    return { status: failure.status, body: { error: failure.error } };
  }

  if (!pingSendAllowed(recent.data?.length ?? 0)) {
    return { status: 429, body: { error: PING_RATE_LIMIT_MESSAGE } };
  }

  const inserted = await session.supabase
    .from("pings")
    .insert({
      circle_id: input.circleId,
      from_user_id: session.userId,
      to_user_id: partner.partnerId,
      ping_type: "thinking-of-you",
      mood_emoji: null,
      secret_variant: input.secretVariant,
    })
    .select("id, secret_variant")
    .single();

  if (inserted.error || !inserted.data) {
    const mapped = pingWriteFailure(inserted.error?.message);
    if (mapped) return { status: mapped.status, body: { error: mapped.error } };
    console.error("Ping insert failed.", inserted.error?.code);
    return { status: 500, body: { error: "That ping couldn't be saved." } };
  }

  revalidatePath(`/circles/${input.circleId}`);
  revalidatePath("/home");

  const delivery = await pushToPartner({
    partnerId: partner.partnerId,
    origin: input.origin,
    circleId: input.circleId,
    secretVariant: inserted.data.secret_variant,
  });

  return {
    status: 200,
    body: {
      ok: true,
      pingId: inserted.data.id,
      secretVariant: inserted.data.secret_variant,
      ...delivery,
    },
  };
}

async function pushToPartner(input: {
  partnerId: string;
  origin: string;
  circleId: string;
  secretVariant: boolean;
}): Promise<{
  devices: number;
  sent: number;
  removed: number;
  push: "sent" | "unconfigured" | "none" | "failed";
}> {
  const vapid = getVapidConfig();
  const admin = createAdminClient();
  if (!vapid || !admin) {
    return { devices: 0, sent: 0, removed: 0, push: "unconfigured" };
  }

  const { data: rows, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.partnerId);

  if (error || !rows) {
    console.error("Could not load the recipient's devices.");
    return { devices: 0, sent: 0, removed: 0, push: "failed" };
  }
  if (rows.length === 0) {
    return { devices: 0, sent: 0, removed: 0, push: "none" };
  }

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
    if (staleIds.length > 0) {
      const { error: deleteError } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("user_id", input.partnerId)
        .in("id", staleIds);
      if (deleteError) {
        console.error("Could not prune the recipient's dead devices.");
      }
    }

    const sent = results.filter(
      (result) =>
        result.statusCode !== null &&
        result.statusCode >= 200 &&
        result.statusCode < 300,
    ).length;

    return {
      devices: rows.length,
      sent,
      removed: staleIds.length,
      push: "sent",
    };
  } catch (error) {
    console.error(
      "Ping was saved but delivery threw.",
      error instanceof Error ? error.name : "error",
    );
    return { devices: rows.length, sent: 0, removed: 0, push: "failed" };
  }
}
