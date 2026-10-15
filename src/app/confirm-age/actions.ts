"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AGE_REQUIRED_MESSAGE } from "@/lib/account/copy";
import { safeNextPath } from "@/lib/auth/safe-next";
import { getSession } from "@/lib/supabase/session";

export type ConfirmAgeState = { error: string | null };

/**
 * Records the 13+ confirmation for someone who is already signed in.
 * The sign-in form sets the same column through the auth callback.
 */
export async function confirmAge(
  _previous: ConfirmAgeState,
  formData: FormData,
): Promise<ConfirmAgeState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const confirmed = z.literal("yes").safeParse(formData.get("age"));
  if (!confirmed.success) return { error: AGE_REQUIRED_MESSAGE };

  const { error } = await session.supabase
    .from("account_private")
    .update({ age_confirmed_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("age_confirmed_at", null);

  if (error) {
    console.error("Age confirmation was not saved.", error.code);
    return { error: "That confirmation wasn't saved. Try again." };
  }

  const next = z.string().max(2000).safeParse(formData.get("next"));
  redirect(
    safeNextPath(next.success ? next.data : null, "https://hsummer.vercel.app"),
  );
}
