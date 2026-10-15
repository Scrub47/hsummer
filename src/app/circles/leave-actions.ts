"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { cancelScheduledMessages } from "@/lib/account/cancel-messages";
import { demoWriteMessage } from "@/lib/account/copy";
import { isCircleId } from "@/lib/bucket/fields";
import { getSession } from "@/lib/supabase/session";

export type LeaveState = { error: string | null };

const choice = z.enum(["keep", "remove"]);

/**
 * Leaves one circle. The default is keep. Remove deletes this person's
 * photos, notes, sent letters, and booth frames in this circle only.
 * Scheduled letters are cancelled either way, including their QStash messages.
 */
export async function leaveCircle(
  _previous: LeaveState,
  formData: FormData,
): Promise<LeaveState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = formData.get("circleId");
  if (typeof circleId !== "string" || !isCircleId(circleId)) {
    return { error: "That circle isn't available." };
  }

  const parsed = choice.safeParse(formData.get("choice"));
  if (!parsed.success) {
    return { error: "Choose whether to keep your contributions." };
  }

  const { data, error } = await session.supabase.rpc("leave_circle", {
    target_circle: circleId,
    remove_content: parsed.data === "remove",
  });

  if (error) {
    console.error("leave_circle failed.", error.code);
    return {
      error:
        demoWriteMessage(error.message) ??
        "You couldn't leave this circle. Try again.",
    };
  }

  await cancelScheduledMessages(data);
  revalidatePath("/circles");
  revalidatePath("/home");
  redirect("/circles");
}
