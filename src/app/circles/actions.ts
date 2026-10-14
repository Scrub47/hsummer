"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";
import {
  INVITE_RATE_LIMIT_MESSAGE,
  INVITE_WRITE_LIMIT,
  INVITE_WRITE_WINDOW_MINUTES,
  circleRpcFailure,
  parseCircleName,
  parseCircleType,
} from "@/lib/circles/fields";
import { muteUntilFromChoice } from "@/lib/push/batch";
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

export type InviteCapState = { error: string | null; saved: boolean };

/** Sets how many times a group link can be used. Blank means until it expires. */
export async function setInviteCap(
  _previous: InviteCapState,
  formData: FormData,
): Promise<InviteCapState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const raw = formData.get("maxUses");
  const text = typeof raw === "string" ? raw.trim() : "";
  let nextMax: number | null = null;
  if (text !== "" && text !== "unlimited") {
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      return {
        error:
          "Pick a limit from 1 to 100, or leave it open until the link expires.",
        saved: false,
      };
    }
    nextMax = parsed;
  }

  const { error } = await session.supabase.rpc("set_invite_max_uses", {
    target_circle: circleId,
    next_max: nextMax,
  });
  if (error) {
    console.error("set_invite_max_uses failed.", error.message);
    return {
      error: circleRpcFailure(error.message) ?? "That limit wasn't saved.",
      saved: false,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

export type MuteState = { error: string | null; saved: boolean };

/** Mutes pushes from one group circle. A couple circle cannot mute. */
export async function setCircleMute(
  _previous: MuteState,
  formData: FormData,
): Promise<MuteState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }
  const choice = stringField(formData.get("mute")) ?? "";
  const until = muteUntilFromChoice(choice, new Date());
  if (until === undefined) {
    return { error: "Choose how long to mute.", saved: false };
  }

  const circle = await session.supabase
    .from("circles")
    .select("circle_type, is_demo")
    .eq("id", circleId)
    .maybeSingle();
  if (circle.error || !circle.data) {
    return { error: "That circle isn't available.", saved: false };
  }
  if (circle.data.is_demo) {
    return {
      error: demoWriteMessage("hsummer_demo_readonly") ?? "This demo circle is only for looking.",
      saved: false,
    };
  }
  if (circle.data.circle_type === "couple") {
    return { error: "A couple circle doesn't mute.", saved: false };
  }

  const updated = await session.supabase
    .from("circle_members")
    .update({ muted_until: until })
    .eq("circle_id", circleId)
    .eq("user_id", session.userId)
    .select("user_id");

  if (updated.error || !updated.data || updated.data.length === 0) {
    console.error("Mute failed.", updated.error?.code);
    return { error: "That mute wasn't saved.", saved: false };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
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
