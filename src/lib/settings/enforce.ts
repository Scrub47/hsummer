import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getQstashConfig } from "@/lib/env.server";
import { firstName } from "@/lib/profile/first-name";
import {
  allowsKind,
  parsePrefs,
  quietDecision,
  quietNotice,
  type NotificationPrefs,
  type NotifyKind,
} from "@/lib/settings/prefs";

export type RecipientSettings = {
  prefs: NotificationPrefs;
  timeZone: string;
  name: string;
};

/**
 * Reads one person's notification settings with the service role.
 * account_private is owner-only, so the sender's session cannot do this.
 * A missing key means the send path keeps today's behavior.
 */
export async function loadRecipientSettings(
  userId: string,
): Promise<RecipientSettings | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  try {
    const [account, profile] = await Promise.all([
      admin
        .from("account_private")
        .select("notification_prefs")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("timezone, display_name")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (account.error || profile.error || !profile.data) return null;
    return {
      prefs: parsePrefs(account.data?.notification_prefs ?? {}),
      timeZone: profile.data.timezone,
      name: firstName(profile.data.display_name),
    };
  } catch (error) {
    console.error(
      "Notification settings could not be read.",
      error instanceof Error ? error.name : "error",
    );
    return null;
  }
}

/** Drops people who turned this kind off. A missing admin client keeps everyone. */
export async function notifiedUserIds(
  userIds: readonly string[],
  kind: NotifyKind,
  circleType: string | null,
): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const admin = createAdminClient();
  if (!admin) return ids;
  try {
    const rows = await admin
      .from("account_private")
      .select("user_id, notification_prefs")
      .in("user_id", ids);
    if (rows.error || !rows.data) return ids;
    const byUser = new Map(
      rows.data.map((row) => [row.user_id, parsePrefs(row.notification_prefs)]),
    );
    return ids.filter((id) =>
      allowsKind(byUser.get(id) ?? parsePrefs({}), kind, circleType),
    );
  } catch (error) {
    console.error(
      "Notification filter failed.",
      error instanceof Error ? error.name : "error",
    );
    return ids;
  }
}

export type PingPlan = {
  deliverIds: string[];
  notices: string[];
};

/**
 * Decides who gets a ping push now.
 *
 * Quiet hours hold the push and tell the sender when it will go out.
 * A turned-off ping toggle skips the push and does not say why.
 * When the service role is not configured, everyone is delivered, which
 * matches the unconfigured push path.
 */
export async function planPingDelivery(input: {
  userIds: readonly string[];
  circleId: string;
  pingId: string;
  circleType: string;
  origin: string;
}): Promise<PingPlan> {
  const ids = [...new Set(input.userIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return { deliverIds: [], notices: [] };

  const admin = createAdminClient();
  if (!admin) return { deliverIds: ids, notices: [] };

  const deliverIds: string[] = [];
  const notices: string[] = [];

  for (const userId of ids) {
    const settings = await loadRecipientSettings(userId);
    if (!settings) {
      deliverIds.push(userId);
      continue;
    }
    if (!allowsKind(settings.prefs, "pings", input.circleType)) continue;

    const decision = quietDecision({
      prefs: settings.prefs,
      timeZone: settings.timeZone,
    });
    if (!decision.inQuiet || !decision.deliverAt) {
      deliverIds.push(userId);
      continue;
    }

    const held = await admin
      .from("held_notifications")
      .insert({
        user_id: userId,
        circle_id: input.circleId,
        kind: "ping",
        ref_id: input.pingId,
        deliver_at: decision.deliverAt,
      })
      .select("id")
      .maybeSingle();
    if (held.error || !held.data) {
      console.error("Could not hold a quiet-hours ping.", held.error?.code);
    } else {
      await scheduleQuietRelease({
        heldId: held.data.id,
        deliverAt: decision.deliverAt,
        origin: input.origin,
      });
    }
    notices.push(quietNotice(settings.name, decision.resumeLabel ?? "8 AM"));
  }

  return { deliverIds, notices };
}

async function scheduleQuietRelease(input: {
  heldId: string;
  deliverAt: string;
  origin: string;
}): Promise<void> {
  const config = getQstashConfig();
  if (!config) return;
  let callback: string;
  try {
    const url = new URL(input.origin);
    if (url.protocol !== "https:") return;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return;
    }
    callback = new URL("/api/quiet/release", url.origin).toString();
  } catch {
    return;
  }
  const notBefore = Math.floor(Date.parse(input.deliverAt) / 1000);
  if (!Number.isFinite(notBefore)) return;
  try {
    const response = await fetch(
      `https://qstash.upstash.io/v2/publish/${callback}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "Upstash-Not-Before": String(notBefore),
          "Upstash-Retries": "5",
        },
        body: JSON.stringify({ heldId: input.heldId }),
      },
    );
    if (!response.ok) {
      console.error(
        "QStash did not accept the quiet-hours ping.",
        response.status,
      );
    }
  } catch (error) {
    console.error(
      "QStash quiet-hours schedule failed.",
      error instanceof Error ? error.name : "error",
    );
  }
}
