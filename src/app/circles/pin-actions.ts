"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isCircleId } from "@/lib/bucket/fields";
import { getSession } from "@/lib/supabase/session";

export type PinState = { error: string | null; saved: boolean };

const inputSchema = z.object({
  circleId: z.string().refine(isCircleId),
  letterId: z.string().uuid(),
});

export async function togglePin(
  _previous: PinState,
  formData: FormData,
): Promise<PinState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const parsed = inputSchema.safeParse({
    circleId: formData.get("circleId"),
    letterId: formData.get("letterId"),
  });
  if (!parsed.success) {
    return { error: "That letter isn't available.", saved: false };
  }

  const existing = await session.supabase
    .from("letter_pins")
    .select("id")
    .eq("letter_id", parsed.data.letterId)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (existing.error) {
    console.error("Pin lookup failed.", existing.error.code);
    return {
      error:
        "Keepsakes aren't available yet. Apply the part 2 SQL, then try again.",
      saved: false,
    };
  }

  if (existing.data) {
    const removed = await session.supabase
      .from("letter_pins")
      .delete()
      .eq("id", existing.data.id);
    if (removed.error) {
      return { error: "That pin couldn't be removed.", saved: false };
    }
  } else {
    const inserted = await session.supabase.from("letter_pins").insert({
      letter_id: parsed.data.letterId,
      circle_id: parsed.data.circleId,
      user_id: session.userId,
    });
    if (inserted.error) {
      return {
        error: inserted.error.message.includes("hsummer_pin")
          ? "That letter isn't available to pin."
          : "That letter couldn't be pinned.",
        saved: false,
      };
    }
  }

  revalidatePath(`/circles/${parsed.data.circleId}`);
  return { error: null, saved: true };
}
