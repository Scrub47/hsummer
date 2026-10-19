"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isCircleId } from "@/lib/bucket/fields";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import {
  REACTION_LIMIT,
  REACTION_RATE_LIMIT_MESSAGE,
  REACTION_WINDOW_MINUTES,
  REPLY_LIMIT,
  REPLY_MAX,
  REPLY_RATE_LIMIT_MESSAGE,
  REPLY_WINDOW_MINUTES,
  isReactionCode,
} from "@/lib/settings/prefs";
import { getSession } from "@/lib/supabase/session";

export type ResponseActionState = {
  error: string | null;
  saved: boolean;
};

const targetSchema = z.object({
  circleId: z.string().refine(isCircleId),
  targetKind: z.enum(["letter", "memory"]),
  targetId: z.string().uuid(),
});

const replySchema = z
  .string()
  .trim()
  .min(1)
  .max(REPLY_MAX)
  .refine(
    (value) =>
      !value.includes("@") &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value),
    "Keep the reply as a short note, without an email address.",
  );

const UNAVAILABLE =
  "Reactions aren't available yet. Apply the part 2 SQL in the Supabase SQL editor, then try again.";

function failed(message: string | undefined): string {
  if (!message) return UNAVAILABLE;
  if (message.includes("hsummer_rate_limited")) {
    return message.includes("reply")
      ? REPLY_RATE_LIMIT_MESSAGE
      : REACTION_RATE_LIMIT_MESSAGE;
  }
  if (
    message.includes("hsummer_reaction") ||
    message.includes("hsummer_reply") ||
    message.includes("row-level security")
  ) {
    return "That isn't available to you.";
  }
  return UNAVAILABLE;
}

export async function toggleReaction(
  _previous: ResponseActionState,
  formData: FormData,
): Promise<ResponseActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const parsed = targetSchema.safeParse({
    circleId: formData.get("circleId"),
    targetKind: formData.get("targetKind"),
    targetId: formData.get("targetId"),
  });
  const emoji = String(formData.get("emoji") ?? "");
  if (!parsed.success || !isReactionCode(emoji)) {
    return { error: "Choose one of the reactions.", saved: false };
  }

  const shared = await enforceSharedLimit({
    key: `reaction:${session.userId}`,
    limit: REACTION_LIMIT,
    window: `${REACTION_WINDOW_MINUTES} m`,
    error: REACTION_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const existing = await session.supabase
    .from("reactions")
    .select("id")
    .eq("target_kind", parsed.data.targetKind)
    .eq("target_id", parsed.data.targetId)
    .eq("emoji", emoji)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (existing.error) {
    console.error("Reaction lookup failed.", existing.error.code);
    return { error: UNAVAILABLE, saved: false };
  }

  if (existing.data) {
    const removed = await session.supabase
      .from("reactions")
      .delete()
      .eq("id", existing.data.id);
    if (removed.error) {
      return { error: failed(removed.error.message), saved: false };
    }
  } else {
    const inserted = await session.supabase.from("reactions").insert({
      circle_id: parsed.data.circleId,
      user_id: session.userId,
      target_kind: parsed.data.targetKind,
      target_id: parsed.data.targetId,
      emoji,
    });
    if (inserted.error) {
      const message = inserted.error.message.includes("hsummer_rate_limited")
        ? REACTION_RATE_LIMIT_MESSAGE
        : failed(inserted.error.message);
      return { error: message, saved: false };
    }
  }

  revalidatePath(`/circles/${parsed.data.circleId}`);
  return { error: null, saved: true };
}

export async function addReply(
  _previous: ResponseActionState,
  formData: FormData,
): Promise<ResponseActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const parsed = targetSchema.safeParse({
    circleId: formData.get("circleId"),
    targetKind: formData.get("targetKind"),
    targetId: formData.get("targetId"),
  });
  const body = replySchema.safeParse(formData.get("body"));
  if (!parsed.success) {
    return { error: "That isn't available.", saved: false };
  }
  if (!body.success) {
    return {
      error: "Keep the reply as a short note, without an email address.",
      saved: false,
    };
  }

  const shared = await enforceSharedLimit({
    key: `reply:${session.userId}`,
    limit: REPLY_LIMIT,
    window: `${REPLY_WINDOW_MINUTES} m`,
    error: REPLY_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const inserted = await session.supabase.from("replies").insert({
    circle_id: parsed.data.circleId,
    user_id: session.userId,
    target_kind: parsed.data.targetKind,
    target_id: parsed.data.targetId,
    body: body.data,
  });
  if (inserted.error) {
    const message = inserted.error.message.includes("hsummer_rate_limited")
      ? REPLY_RATE_LIMIT_MESSAGE
      : failed(inserted.error.message);
    return { error: message, saved: false };
  }

  revalidatePath(`/circles/${parsed.data.circleId}`);
  return { error: null, saved: true };
}
