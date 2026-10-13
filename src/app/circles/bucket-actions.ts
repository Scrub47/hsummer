"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  bucketWriteFailure,
  isCircleId,
  parseBucketForm,
} from "@/lib/bucket/fields";
import { getSession } from "@/lib/supabase/session";

export type BucketActionState = {
  error: string | null;
  saved: boolean;
};

export async function addBucketItem(
  _previous: BucketActionState,
  formData: FormData,
): Promise<BucketActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const parsed = parseBucketForm(formData, { statusDefaultsToIdea: true });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const { error } = await session.supabase.from("bucket_items").insert({
    circle_id: circleId,
    title: parsed.value.title,
    category: parsed.value.category,
    status: parsed.value.status,
    planned_date: parsed.value.plannedDate,
    notes: parsed.value.notes,
    link: parsed.value.link,
  });

  if (error) {
    console.error("Bucket item insert failed.", error.code);
    return {
      error:
        bucketWriteFailure(error.message, error.code) ??
        "That item wasn't saved.",
      saved: false,
    };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

export async function updateBucketItem(
  _previous: BucketActionState,
  formData: FormData,
): Promise<BucketActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const id = stringField(formData.get("id"));
  const circleId = stringField(formData.get("circleId"));
  if (!id || !isCircleId(id) || !circleId || !isCircleId(circleId)) {
    return { error: "That item isn't on your list.", saved: false };
  }

  const parsed = parseBucketForm(formData, { statusDefaultsToIdea: false });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const { data, error } = await session.supabase
    .from("bucket_items")
    .update({
      title: parsed.value.title,
      category: parsed.value.category,
      status: parsed.value.status,
      planned_date: parsed.value.plannedDate,
      notes: parsed.value.notes,
      link: parsed.value.link,
    })
    .eq("id", id)
    .eq("circle_id", circleId)
    .select("id");

  if (error) {
    console.error("Bucket item update failed.", error.code);
    return {
      error:
        bucketWriteFailure(error.message, error.code) ??
        "That item wasn't saved.",
      saved: false,
    };
  }
  if (!data || data.length === 0) {
    return { error: "You can't change that item.", saved: false };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

export async function deleteBucketItem(
  _previous: BucketActionState,
  formData: FormData,
): Promise<BucketActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const id = stringField(formData.get("id"));
  const circleId = stringField(formData.get("circleId"));
  if (!id || !isCircleId(id) || !circleId || !isCircleId(circleId)) {
    return { error: "That item isn't on your list.", saved: false };
  }

  const { data, error } = await session.supabase
    .from("bucket_items")
    .delete()
    .eq("id", id)
    .eq("circle_id", circleId)
    .select("id");

  if (error) {
    console.error("Bucket item delete failed.", error.code);
    return {
      error:
        bucketWriteFailure(error.message, error.code) ??
        "That item wasn't saved.",
      saved: false,
    };
  }
  if (!data || data.length === 0) {
    return { error: "You can't remove that item.", saved: false };
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

function stringField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
