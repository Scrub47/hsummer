"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { cancelScheduledMessages } from "@/lib/account/cancel-messages";
import { demoWriteMessage } from "@/lib/account/copy";
import { getSession } from "@/lib/supabase/session";

export type DeleteAccountState = { error: string | null };

const choice = z.enum(["keep", "remove"]);

/**
 * Deletes the signed-in account. Personal data always goes: profile, login,
 * avatar files, push subscriptions, moods, and pings. Shared contributions
 * stay as Former member unless the person chooses remove.
 */
export async function deleteAccount(
  _previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const parsed = choice.safeParse(formData.get("choice"));
  const confirm = z.literal("delete").safeParse(formData.get("confirm"));
  if (!parsed.success || !confirm.success) {
    return {
      error: 'Choose what happens to shared contributions, and type "delete".',
    };
  }

  const { data, error } = await session.supabase.rpc("delete_own_account", {
    remove_content: parsed.data === "remove",
  });

  if (error) {
    console.error("delete_own_account failed.", error.code);
    return {
      error:
        demoWriteMessage(error.message) ??
        "The account wasn't deleted. Nothing was removed. Try again.",
    };
  }

  await cancelScheduledMessages(data);
  await session.supabase.auth.signOut();
  redirect("/?deleted=1");
}
