"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { pushOrigin } from "@/lib/auth/request-origin";
import {
  CHECKPOINT_LIMIT,
  CHECKPOINT_RATE_LIMIT_MESSAGE,
  CHECKPOINT_WINDOW_MINUTES,
  countdownWriteFailure,
  isCircleId,
  parseCheckpointDraft,
  parseCountdownDraft,
} from "@/lib/countdowns/fields";
import { notifyCheckpoint } from "@/lib/countdowns/notify";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession } from "@/lib/supabase/session";

export type CountdownActionState = {
  error: string | null;
  saved: boolean;
};

/** Sets the reunion date on this circle's countdown, or creates the one row. */
export async function saveCountdown(
  _previous: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const parsed = parseCountdownDraft({
    label: formData.get("label"),
    targetDate: formData.get("targetDate"),
  });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const existingId = stringField(formData.get("countdownId"));
  if (existingId && !isCircleId(existingId)) {
    return { error: "That countdown isn't here.", saved: false };
  }

  if (existingId) {
    const updated = await session.supabase
      .from("countdowns")
      .update({
        label: parsed.value.label,
        target_date: parsed.value.targetDate,
      })
      .eq("id", existingId)
      .eq("circle_id", circleId)
      .select("id");
    if (updated.error) {
      console.error("Countdown update failed.", updated.error.code);
      return {
        error:
          countdownWriteFailure(updated.error.message, updated.error.code) ??
          "That date wasn't saved.",
        saved: false,
      };
    }
    if (!updated.data || updated.data.length === 0) {
      return { error: "You can't change that countdown.", saved: false };
    }
  } else {
    const inserted = await session.supabase.from("countdowns").insert({
      circle_id: circleId,
      label: parsed.value.label,
      target_date: parsed.value.targetDate,
      created_by: session.userId,
    });
    if (inserted.error) {
      console.error("Countdown insert failed.", inserted.error.code);
      return {
        error:
          countdownWriteFailure(inserted.error.message, inserted.error.code) ??
          "That countdown wasn't saved.",
        saved: false,
      };
    }
  }

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, saved: true };
}

/** Adds a checkpoint. An auto date that is already today is hit on this save. */
export async function addCheckpoint(
  _previous: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  const countdownId = stringField(formData.get("countdownId"));
  if (
    !circleId ||
    !countdownId ||
    !isCircleId(circleId) ||
    !isCircleId(countdownId)
  ) {
    return { error: "That countdown isn't here.", saved: false };
  }

  const parsed = parseCheckpointDraft({
    label: formData.get("label"),
    date: formData.get("date"),
    trigger: formData.get("trigger"),
  });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const shared = await enforceSharedLimit({
    key: `checkpoint:${session.userId}`,
    limit: CHECKPOINT_LIMIT,
    window: `${CHECKPOINT_WINDOW_MINUTES} m`,
    error: CHECKPOINT_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const inserted = await session.supabase.from("checkpoints").insert({
    countdown_id: countdownId,
    circle_id: circleId,
    label: parsed.value.label,
    date: parsed.value.date,
    trigger: parsed.value.trigger,
    created_by: session.userId,
  });
  if (inserted.error) {
    console.error("Checkpoint insert failed.", inserted.error.code);
    return {
      error:
        countdownWriteFailure(inserted.error.message, inserted.error.code) ??
        "That checkpoint wasn't saved.",
      saved: false,
    };
  }

  if (parsed.value.trigger === "auto-by-date") {
    const synced = await session.supabase.rpc("sync_auto_checkpoints", {
      target_circle: circleId,
    });
    if (synced.error) {
      console.error("Checkpoint sync failed.", synced.error.code);
    } else if ((synced.data ?? []).length > 0) {
      await notifyOthers(session.userId, circleId);
    }
  }

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, saved: true };
}

/** Marks a manual checkpoint hit. A second tap keeps the same memory. */
export async function markCheckpointHit(
  _previous: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  const checkpointId = stringField(formData.get("checkpointId"));
  if (
    !circleId ||
    !checkpointId ||
    !isCircleId(circleId) ||
    !isCircleId(checkpointId)
  ) {
    return { error: "That checkpoint isn't here.", saved: false };
  }

  const before = await session.supabase
    .from("checkpoints")
    .select("hit_at")
    .eq("id", checkpointId)
    .eq("circle_id", circleId)
    .maybeSingle();

  const hit = await session.supabase.rpc("hit_checkpoint", {
    target: checkpointId,
  });
  if (hit.error || !hit.data) {
    console.error("Checkpoint hit failed.", hit.error?.code);
    return {
      error:
        countdownWriteFailure(hit.error?.message, hit.error?.code) ??
        "That checkpoint wasn't marked.",
      saved: false,
    };
  }

  if (!before.data?.hit_at) {
    await notifyOthers(session.userId, circleId);
  }
  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, saved: true };
}

export async function deleteCheckpoint(
  _previous: CountdownActionState,
  formData: FormData,
): Promise<CountdownActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  const checkpointId = stringField(formData.get("checkpointId"));
  if (
    !circleId ||
    !checkpointId ||
    !isCircleId(circleId) ||
    !isCircleId(checkpointId)
  ) {
    return { error: "That checkpoint isn't here.", saved: false };
  }

  const removed = await session.supabase
    .from("checkpoints")
    .delete()
    .eq("id", checkpointId)
    .eq("circle_id", circleId)
    .is("hit_at", null)
    .select("id");

  if (removed.error) {
    console.error("Checkpoint delete failed.", removed.error.code);
    return {
      error:
        countdownWriteFailure(removed.error.message, removed.error.code) ??
        "That checkpoint wasn't removed.",
      saved: false,
    };
  }
  if (!removed.data || removed.data.length === 0) {
    return { error: "You can't remove that checkpoint.", saved: false };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

async function notifyOthers(selfId: string, circleId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const members = await session.supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .is("left_at", null);
  if (members.error || !members.data) return;
  const headerList = await headers();
  await notifyCheckpoint({
    userIds: members.data
      .map((row) => row.user_id)
      .filter((id) => id !== selfId),
    origin: pushOrigin(headerList),
    circleId,
  });
}

function stringField(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
