"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  JOIN_IP_LIMIT,
  JOIN_USER_LIMIT,
  JOIN_WINDOW_MINUTES,
  hashIp,
  inviteStateMessage,
  isInviteToken,
  joinPath,
  requestIp,
} from "@/lib/circles/fields";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession } from "@/lib/supabase/session";

/**
 * Confirms a join. The token comes from the invite link, the user id comes
 * from the verified session, and the IP hash is how the database rate-limits
 * a shared network. The raw IP is not stored.
 */
export async function redeemInvite(formData: FormData): Promise<void> {
  const token = stringField(formData.get("token"));
  const next = token && isInviteToken(token) ? joinPath(token) : "/circles";
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!token || !isInviteToken(token)) redirect("/join/invalid");

  const headerList = await headers();
  const ipHash = hashIp(requestIp(headerList));
  const limitedMessage =
    inviteStateMessage("rate_limited") ??
    "Too many tries just now. Wait a little and try again.";
  const userLimited = await enforceSharedLimit({
    key: `redeem-user:${session.userId}`,
    limit: JOIN_USER_LIMIT,
    window: `${JOIN_WINDOW_MINUTES} m`,
    error: limitedMessage,
  });
  const ipLimited = userLimited.ok
    ? await enforceSharedLimit({
        key: `redeem-ip:${ipHash}`,
        limit: JOIN_IP_LIMIT,
        window: `${JOIN_WINDOW_MINUTES} m`,
        error: limitedMessage,
      })
    : userLimited;
  if (!ipLimited.ok) {
    redirect(`${joinPath(token)}?error=rate_limited`);
  }

  const { data, error } = await session.supabase.rpc("redeem_invite", {
    raw_token: token,
    ip_hash: ipHash,
  });

  if (error || !data?.[0]) {
    console.error("redeem_invite failed.", error?.message);
    redirect(`${joinPath(token)}?error=missing`);
  }

  const state = data[0].invite_state;
  const circleId = data[0].circle_id;
  if ((state === "joined" || state === "already_member") && circleId) {
    redirect(`/circles/${circleId}`);
  }

  redirect(`${joinPath(token)}?error=${encodeURIComponent(state)}`);
}

function stringField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
