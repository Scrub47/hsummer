"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DEMO_READONLY_MESSAGE } from "@/lib/account/copy";
import { loadAccountFlags } from "@/lib/account/load";
import { parseTimezone } from "@/lib/profile/fields";
import {
  THEMES,
  parsePrefs,
  type NotificationPrefs,
} from "@/lib/settings/prefs";
import { getSession } from "@/lib/supabase/session";

export type SettingsState = {
  error: string | null;
  saved: boolean;
};

const clock = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

function flag(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export async function saveSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile/settings");

  const account = await loadAccountFlags(session);
  if (account.isDemo) return { error: DEMO_READONLY_MESSAGE, saved: false };

  const timezone = parseTimezone(formData.get("timezone"));
  if (!timezone.ok) return { error: timezone.error, saved: false };

  const theme = z.enum(THEMES).safeParse(formData.get("theme"));
  const start = clock.safeParse(formData.get("quietStart"));
  const end = clock.safeParse(formData.get("quietEnd"));
  if (!theme.success || !start.success || !end.success) {
    return { error: "Check the quiet hours and the theme.", saved: false };
  }

  const prefs: NotificationPrefs = {
    pings: flag(formData, "pings"),
    letters: flag(formData, "letters"),
    booth: flag(formData, "booth"),
    stillUs: flag(formData, "stillUs"),
    group: flag(formData, "group"),
    sounds: flag(formData, "sounds"),
    theme: theme.data,
    quiet: {
      enabled: flag(formData, "quietEnabled"),
      start: start.data,
      end: end.data,
    },
  };
  const stored = parsePrefs(prefs);
  const encoded = JSON.stringify(stored);
  if (encoded.length > 2048) {
    return { error: "Those settings couldn't be saved.", saved: false };
  }

  const [profile, accountUpdate] = await Promise.all([
    session.supabase
      .from("profiles")
      .update({ timezone: timezone.value })
      .eq("id", session.userId)
      .select("id")
      .maybeSingle(),
    session.supabase
      .from("account_private")
      .update({ notification_prefs: stored })
      .eq("user_id", session.userId)
      .select("user_id")
      .maybeSingle(),
  ]);

  if (
    profile.error ||
    !profile.data ||
    accountUpdate.error ||
    !accountUpdate.data
  ) {
    console.error(
      "Settings save failed.",
      profile.error?.code ?? accountUpdate.error?.code,
    );
    return { error: "Those settings couldn't be saved.", saved: false };
  }

  const jar = await cookies();
  jar.set("hsummer-theme", stored.theme, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 400,
    httpOnly: true,
  });

  revalidatePath("/profile");
  revalidatePath("/profile/settings");
  revalidatePath("/home");
  return { error: null, saved: true };
}
