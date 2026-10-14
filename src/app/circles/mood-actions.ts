"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { pushOrigin } from "@/lib/auth/request-origin";
import {
  MOOD_PICK_ERROR,
  isCircleId,
  isMoodEmoji,
  moodWriteFailure,
  type MoodPush,
} from "@/lib/moods/fields";
import { sendThinkingOfYou } from "@/lib/pings/send";
import { getSession } from "@/lib/supabase/session";

export type MoodActionState = {
  error: string | null;
  saved: boolean;
  shared: boolean;
  push: MoodPush | null;
};

/**
 * Saves your current mood for this circle. Nothing is pushed unless the
 * share box was checked, and that path is the Thinking of You sender.
 */
export async function setCurrentMood(
  _previous: MoodActionState,
  formData: FormData,
): Promise<MoodActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  const emoji = stringField(formData.get("emoji"));
  if (!circleId || !isCircleId(circleId) || !emoji || !isMoodEmoji(emoji)) {
    return { error: MOOD_PICK_ERROR, saved: false, shared: false, push: null };
  }

  const saved = await session.supabase
    .from("current_moods")
    .upsert(
      {
        user_id: session.userId,
        circle_id: circleId,
        emoji,
      },
      { onConflict: "user_id,circle_id" },
    )
    .select("emoji")
    .single();

  if (saved.error || !saved.data) {
    console.error("Mood save failed.", saved.error?.code);
    return {
      error:
        moodWriteFailure(saved.error?.message, saved.error?.code) ??
        "That mood wasn't saved.",
      saved: false,
      shared: false,
      push: null,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");

  if (formData.get("share") !== "on") {
    return { error: null, saved: true, shared: false, push: null };
  }

  const headerList = await headers();
  const result = await sendThinkingOfYou(session, {
    circleId,
    secretVariant: false,
    origin: pushOrigin(headerList),
    moodEmoji: emoji,
  });

  if (result.status !== 200 || !("ok" in result.body)) {
    const error =
      "error" in result.body
        ? result.body.error
        : "That ping couldn't be sent.";
    return { error, saved: true, shared: false, push: null };
  }

  return {
    error: null,
    saved: true,
    shared: true,
    push: result.body.push,
  };
}

/** Clears your mood. This does not send a ping. */
export async function clearCurrentMood(
  _previous: MoodActionState,
  formData: FormData,
): Promise<MoodActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: MOOD_PICK_ERROR, saved: false, shared: false, push: null };
  }

  const removed = await session.supabase
    .from("current_moods")
    .delete()
    .eq("circle_id", circleId)
    .eq("user_id", session.userId);

  if (removed.error) {
    console.error("Mood clear failed.", removed.error.code);
    return {
      error:
        moodWriteFailure(removed.error.message, removed.error.code) ??
        "That mood wasn't cleared.",
      saved: false,
      shared: false,
      push: null,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, saved: true, shared: false, push: null };
}

function stringField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
