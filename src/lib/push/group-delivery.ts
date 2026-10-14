import "server-only";

import * as webpush from "web-push";

import { getVapidConfig } from "@/lib/env.server";
import { decideGroupPush } from "@/lib/push/batch";
import {
  buildDigestNotification,
  type TestNotification,
} from "@/lib/push/payload";
import { deliverTestPushes, subscriptionsToPrune } from "@/lib/push/prune";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends a group push, or holds it for the rest of the minute.
 *
 * A couple must not be passed here. Their notifications stay one-at-a-time
 * and are not muted by this window. A muted group membership gets nothing.
 * The lock-screen text is the caller's generic sentence, or one digest
 * sentence when earlier buzzes were held. Names are not added.
 */
export async function deliverGroupPushes(input: {
  circleId: string;
  userIds: readonly string[];
  origin: string;
  specific: TestNotification;
}): Promise<"unconfigured" | "done"> {
  const ids = [...new Set(input.userIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return "done";

  try {
    const vapid = getVapidConfig();
    const admin = createAdminClient();
    if (!vapid || !admin) return "unconfigured";

    const [members, windows] = await Promise.all([
      admin
        .from("circle_members")
        .select("user_id, muted_until")
        .eq("circle_id", input.circleId)
        .in("user_id", ids)
        .is("left_at", null),
      admin
        .from("circle_push_windows")
        .select("user_id, last_sent_at, held_count")
        .eq("circle_id", input.circleId)
        .in("user_id", ids),
    ]);

    if (members.error) {
      console.error("Group push membership failed.", members.error.code);
      return "done";
    }
    if (
      windows.error &&
      !isMissingWindow(windows.error.message, windows.error.code)
    ) {
      console.error("Group push window failed.", windows.error.code);
      return "done";
    }

    const windowByUser = new Map(
      (windows.data ?? []).map((row) => [row.user_id, row]),
    );
    const now = Date.now();
    const digest = buildDigestNotification(input.origin, input.circleId);
    const sends: { userId: string; payload: TestNotification }[] = [];

    for (const member of members.data ?? []) {
      const window = windowByUser.get(member.user_id);
      const decision = decideGroupPush({
        mutedUntil: member.muted_until,
        nowMs: now,
        lastSentAtMs: window?.last_sent_at
          ? Date.parse(window.last_sent_at)
          : null,
        heldCount: window?.held_count ?? 0,
      });

      if (decision.decision !== "muted" && !windows.error) {
        const saved = await admin.from("circle_push_windows").upsert(
          {
            circle_id: input.circleId,
            user_id: member.user_id,
            held_count: decision.nextHeld,
            last_sent_at: decision.stampSent
              ? new Date(now).toISOString()
              : (window?.last_sent_at ?? null),
          },
          { onConflict: "circle_id,user_id" },
        );
        if (saved.error) {
          console.error("Group push window write failed.", saved.error.code);
        }
      }

      if (decision.decision === "send") {
        sends.push({ userId: member.user_id, payload: input.specific });
      } else if (decision.decision === "digest") {
        sends.push({ userId: member.user_id, payload: digest });
      }
    }

    for (const send of sends) {
      await pushOne({
        userId: send.userId,
        payload: JSON.stringify(send.payload),
        vapid,
        admin,
      });
    }
    return "done";
  } catch (error) {
    console.error(
      "A group push threw.",
      error instanceof Error ? error.name : "error",
    );
    return "done";
  }
}

function isMissingWindow(
  message: string | undefined,
  code: string | undefined,
): boolean {
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message?.includes("circle_push_windows") ?? false)
  );
}

async function pushOne(input: {
  userId: string;
  payload: string;
  vapid: NonNullable<ReturnType<typeof getVapidConfig>>;
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
}): Promise<void> {
  const { data: rows, error } = await input.admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.userId);
  if (error || !rows || rows.length === 0) return;

  const results = await deliverTestPushes(
    rows,
    input.payload,
    async (subscription, body) => {
      const result = await webpush.sendNotification(subscription, body, {
        vapidDetails: input.vapid,
        TTL: 60 * 60,
      });
      return result.statusCode;
    },
  );

  const staleIds = subscriptionsToPrune(results);
  if (staleIds.length === 0) return;
  const removed = await input.admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", input.userId)
    .in("id", staleIds);
  if (removed.error) {
    console.error("Could not prune a dead device after a group push.");
  }
}
