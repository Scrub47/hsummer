"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  INVITE_RATE_LIMIT_MESSAGE,
  INVITE_WRITE_LIMIT,
  INVITE_WRITE_WINDOW_MINUTES,
  circleRpcFailure,
  parseCircleName,
  parseCircleType,
} from "@/lib/circles/fields";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession } from "@/lib/supabase/session";

export type CreateCircleState = {
  error: string | null;
  circleId: string | null;
  inviteId: string | null;
  token: string | null;
  expiresAt: string | null;
};

export type CircleActionState = {
  error: string | null;
  inviteId: string | null;
  token: string | null;
  expiresAt: string | null;
};

const UNAVAILABLE =
  "Circles aren't available yet. Apply the week 3 SQL in the Supabase SQL editor, then try again.";

/**
 * Creates a couple circle for the signed-in person and returns the invite
 * token once. The browser stores that token, then opens the circle. The
 * database only keeps the hash.
 */
export async function createCircle(
  _previous: CreateCircleState,
  formData: FormData,
): Promise<CreateCircleState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const name = parseCircleName(formData.get("name"));
  if (!name.ok) return emptyCreate(name.error);
  const circleType = parseCircleType(formData.get("circleType") ?? "couple");
  if (!circleType.ok) return emptyCreate(circleType.error);

  const limited = await limitInviteWrites(session.userId);
  if (limited) return emptyCreate(limited);

  const { data, error } = await session.supabase.rpc("create_circle", {
    circle_name: name.value,
    circle_type: circleType.value,
  });

  if (error || !data?.[0]) {
    console.error("create_circle failed.", error?.message);
    return emptyCreate(circleRpcFailure(error?.message) ?? UNAVAILABLE);
  }

  revalidatePath("/circles");
  revalidatePath("/home");
  return {
    error: null,
    circleId: data[0].circle_id,
    inviteId: data[0].invite_id,
    token: data[0].token,
    expiresAt: data[0].expires_at,
  };
}

export async function renameCircle(
  _previous: CircleActionState,
  formData: FormData,
): Promise<CircleActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId) return emptyAction("That circle isn't available.");

  const name = parseCircleName(formData.get("name"));
  if (!name.ok) return emptyAction(name.error);

  const { data, error } = await session.supabase
    .from("circles")
    .update({ name: name.value })
    .eq("id", circleId)
    .select("id");

  if (error) {
    console.error("Circle rename failed.", error.message);
    return emptyAction(
      circleRpcFailure(error.message) ?? "The name wasn't saved.",
    );
  }
  if (!data || data.length === 0) {
    return emptyAction("You can't rename this circle.");
  }

  revalidatePath("/circles");
  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return emptyAction(null);
}

/**
 * Revokes the live link and returns a new token. The old link stops working
 * as soon as this returns.
 */
export async function regenerateInvite(
  _previous: CircleActionState,
  formData: FormData,
): Promise<CircleActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId) return emptyAction("That circle isn't available.");

  const limited = await limitInviteWrites(session.userId);
  if (limited) return emptyAction(limited);

  const { data, error } = await session.supabase.rpc("regenerate_invite", {
    target_circle: circleId,
  });

  if (error || !data?.[0]) {
    console.error("regenerate_invite failed.", error?.message);
    return emptyAction(circleRpcFailure(error?.message) ?? UNAVAILABLE);
  }

  revalidatePath(`/circles/${circleId}`);
  return {
    error: null,
    inviteId: data[0].invite_id,
    token: data[0].token,
    expiresAt: data[0].expires_at,
  };
}

function emptyCreate(error: string): CreateCircleState {
  return {
    error,
    circleId: null,
    inviteId: null,
    token: null,
    expiresAt: null,
  };
}

function emptyAction(error: string | null): CircleActionState {
  return { error, inviteId: null, token: null, expiresAt: null };
}

function stringField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Upstash when it is configured, then the insert trigger either way. */
async function limitInviteWrites(userId: string): Promise<string | null> {
  const decision = await enforceSharedLimit({
    key: `invite:${userId}`,
    limit: INVITE_WRITE_LIMIT,
    window: `${INVITE_WRITE_WINDOW_MINUTES} m`,
    error: INVITE_RATE_LIMIT_MESSAGE,
  });
  if (!decision.ok) return decision.error;
  return null;
}
