"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { pushOrigin } from "@/lib/auth/request-origin";
import { isCircleId } from "@/lib/bucket/fields";
import {
  LETTER_LIMIT,
  LETTER_RATE_LIMIT_MESSAGE,
  LETTER_WINDOW_MINUTES,
  letterWriteFailure,
  parseCategoryLabel,
  parseLetterDraft,
} from "@/lib/letters/fields";
import { notifyLetterRecipient } from "@/lib/letters/notify";
import { partnerReasonMessage, resolveCouplePartner } from "@/lib/pings/fields";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession, type Session } from "@/lib/supabase/session";

export type LetterActionState = {
  error: string | null;
  saved: boolean;
};

export type OpenLetterResult = {
  error: string | null;
  body: string | null;
  title: string | null;
};

const UNAVAILABLE =
  "Letters aren't available yet. Apply the week 11 SQL in the Supabase SQL editor, then try again.";

/**
 * Writes a letter to the other person in an active couple. There is no
 * recipient field. The insert uses the caller's session, so row-level
 * security decides. The trigger delivers it now. The push, if it sends,
 * says only that a letter arrived.
 */
export async function sendLetter(
  _previous: LetterActionState,
  formData: FormData,
): Promise<LetterActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const custom = await session.supabase
    .from("letter_categories")
    .select("label")
    .eq("circle_id", circleId);
  if (custom.error) {
    console.error("Letter categories failed.", custom.error.code);
    return {
      error:
        letterWriteFailure(custom.error.message, custom.error.code) ??
        UNAVAILABLE,
      saved: false,
    };
  }

  const parsed = parseLetterDraft({
    category: formData.get("category"),
    title: formData.get("title"),
    body: formData.get("body"),
    design: formData.get("design"),
    customLabels: (custom.data ?? [])
      .map((row) => row.label)
      .filter((label): label is string => typeof label === "string"),
  });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const partner = await couplePartner(session, circleId);
  if (!partner.ok) return { error: partner.error, saved: false };

  const shared = await enforceSharedLimit({
    key: `letter:${session.userId}`,
    limit: LETTER_LIMIT,
    window: `${LETTER_WINDOW_MINUTES} m`,
    error: LETTER_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const since = new Date(
    Date.now() - LETTER_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();
  const recent = await session.supabase
    .from("letters")
    .select("id", { count: "exact", head: true })
    .eq("from_user_id", session.userId)
    .gt("created_at", since);
  if (recent.error || typeof recent.count !== "number") {
    console.error("Letter count failed.", recent.error?.code);
    return { error: UNAVAILABLE, saved: false };
  }
  if (recent.count >= LETTER_LIMIT) {
    return { error: LETTER_RATE_LIMIT_MESSAGE, saved: false };
  }

  const inserted = await session.supabase
    .from("letters")
    .insert({
      circle_id: circleId,
      from_user_id: session.userId,
      to_user_id: partner.partnerId,
      category: parsed.value.category,
      title: parsed.value.title,
      body: parsed.value.body,
      design: parsed.value.design,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    console.error("Letter insert failed.", inserted.error?.code);
    return {
      error:
        letterWriteFailure(inserted.error?.message, inserted.error?.code) ??
        "That letter wasn't saved.",
      saved: false,
    };
  }

  const headerList = await headers();
  await notifyLetterRecipient({
    recipientId: partner.partnerId,
    origin: pushOrigin(headerList),
    circleId,
  });

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, saved: true };
}

/** Adds a custom open-when label for this circle. */
export async function addLetterCategory(
  _previous: LetterActionState,
  formData: FormData,
): Promise<LetterActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const label = parseCategoryLabel(formData.get("label"));
  if (!label.ok) return { error: label.error, saved: false };

  const inserted = await session.supabase.from("letter_categories").insert({
    circle_id: circleId,
    label: label.value,
    created_by: session.userId,
  });

  if (inserted.error) {
    console.error("Letter category failed.", inserted.error.code);
    return {
      error:
        letterWriteFailure(inserted.error.message, inserted.error.code) ??
        "That category wasn't saved.",
      saved: false,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

/** Removes a custom label. Letters already written keep the words they used. */
export async function deleteLetterCategory(
  _previous: LetterActionState,
  formData: FormData,
): Promise<LetterActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  const id = stringField(formData.get("id"));
  if (!circleId || !isCircleId(circleId) || !id || !isCircleId(id)) {
    return { error: "That category isn't on the list.", saved: false };
  }

  const removed = await session.supabase
    .from("letter_categories")
    .delete()
    .eq("circle_id", circleId)
    .eq("id", id)
    .select("id");

  if (removed.error) {
    console.error("Letter category delete failed.", removed.error.code);
    return {
      error:
        letterWriteFailure(removed.error.message, removed.error.code) ??
        "That category wasn't removed.",
      saved: false,
    };
  }
  if (!removed.data || removed.data.length === 0) {
    return { error: "You can't remove that category.", saved: false };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

/**
 * The recipient opens a delivered letter. The database sets opened_at and
 * creates one memory visible only to the two of them. The body comes back
 * only after that succeeds.
 */
export async function openLetter(
  circleId: string,
  letterId: string,
): Promise<OpenLetterResult> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  if (!isCircleId(circleId) || !isCircleId(letterId)) {
    return { error: "That letter isn't here.", body: null, title: null };
  }

  const opened = await session.supabase.rpc("open_letter", {
    target: letterId,
  });
  if (opened.error || !opened.data) {
    console.error("Letter open failed.", opened.error?.code);
    return {
      error:
        letterWriteFailure(opened.error?.message, opened.error?.code) ??
        "That letter couldn't be opened.",
      body: null,
      title: null,
    };
  }

  const row = await session.supabase
    .from("letters")
    .select("circle_id, to_user_id, title, body, opened_at")
    .eq("id", letterId)
    .maybeSingle();

  if (
    row.error ||
    !row.data ||
    row.data.circle_id !== circleId ||
    row.data.to_user_id !== session.userId ||
    !row.data.opened_at
  ) {
    return {
      error: "That letter couldn't be opened.",
      body: null,
      title: null,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  revalidatePath("/home");
  return { error: null, body: row.data.body, title: row.data.title };
}

async function couplePartner(
  session: Session,
  circleId: string,
): Promise<{ ok: true; partnerId: string } | { ok: false; error: string }> {
  const circle = await session.supabase
    .from("circles")
    .select("circle_type, status")
    .eq("id", circleId)
    .maybeSingle();

  if (circle.error) {
    return { ok: false, error: UNAVAILABLE };
  }
  if (!circle.data) {
    return { ok: false, error: "That circle isn't available." };
  }

  const members = await session.supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .is("left_at", null);

  if (members.error || !members.data) {
    return { ok: false, error: UNAVAILABLE };
  }

  const resolved = resolveCouplePartner({
    selfId: session.userId,
    circleType: circle.data.circle_type,
    status: circle.data.status,
    activeMemberIds: members.data.map((row) => row.user_id),
  });
  if (!resolved.ok) {
    if (resolved.reason === "pending") {
      return {
        ok: false,
        error:
          "Share the invite link first. Letters open once you're both here.",
      };
    }
    if (resolved.reason === "not_couple") {
      return {
        ok: false,
        error: "Choosing a person in a larger circle comes later.",
      };
    }
    return { ok: false, error: partnerReasonMessage(resolved.reason).error };
  }

  return { ok: true, partnerId: resolved.partnerId };
}

function stringField(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
