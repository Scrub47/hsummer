"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isCircleId } from "@/lib/bucket/fields";
import {
  MEMORY_LIMIT,
  MEMORY_MAX_BYTES,
  MEMORY_QUOTA_MESSAGE,
  MEMORY_RATE_LIMIT_MESSAGE,
  MEMORY_WINDOW_MINUTES,
  PHOTO_ERROR,
  MEMORIES_BUCKET,
  memoryPhotoPath,
  memoryWriteFailure,
  parseMemoryForm,
} from "@/lib/memories/fields";
import { sniffMemoryPhoto } from "@/lib/memories/photo";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession, type Session } from "@/lib/supabase/session";

export type MemoryActionState = {
  error: string | null;
  saved: boolean;
};

const UPLOAD_FAILED =
  "The photo couldn't be saved. Apply the week 8 SQL so the private memories bucket exists, then try a JPEG, PNG, or WebP under 2 MB.";

/**
 * Adds a note or a photo to the circle's wall. The user id comes from the
 * verified session. RLS is the backstop. EXIF is removed before the bytes
 * are stored. The signed URL the page shows is created later, for five
 * minutes, and only for someone the select policy already allows.
 */
export async function addMemory(
  _previous: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleId = stringField(formData.get("circleId"));
  if (!circleId || !isCircleId(circleId)) {
    return { error: "That circle isn't available.", saved: false };
  }

  const attachment = formData.get("photo");
  if (attachment instanceof File && attachment.size > MEMORY_MAX_BYTES) {
    return { error: PHOTO_ERROR, saved: false };
  }
  const file =
    attachment instanceof File && attachment.size > 0
      ? new Uint8Array(await attachment.arrayBuffer())
      : null;

  const parsed = parseMemoryForm({
    body: formData.get("body"),
    tags: formData.get("tags"),
    occurredOn: formData.get("occurredOn"),
    visibility: formData.get("visibility"),
    viewerIds: formData
      .getAll("viewer")
      .filter((value): value is string => typeof value === "string")
      .filter((id) => id !== session.userId),
    photo: file,
  });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const photo = parsed.value.photo
    ? sniffMemoryPhoto(parsed.value.photo)
    : null;
  if (photo && !photo.ok) return { error: photo.error, saved: false };

  const shared = await enforceSharedLimit({
    key: `memory:${session.userId}`,
    limit: MEMORY_LIMIT,
    window: `${MEMORY_WINDOW_MINUTES} m`,
    error: MEMORY_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const id = crypto.randomUUID();
  const photoPath = photo
    ? memoryPhotoPath(circleId, id, photo.value.extension)
    : null;

  const inserted = await session.supabase
    .from("memories")
    .insert({
      id,
      circle_id: circleId,
      kind: parsed.value.kind,
      body: parsed.value.body,
      photo_path: photoPath,
      photo_bytes: photo ? photo.value.bytes.byteLength : 0,
      tags: parsed.value.tags,
      visibility: parsed.value.visibility,
      occurred_on: parsed.value.occurredOn,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    console.error("Memory insert failed.", inserted.error?.code);
    return {
      error:
        memoryWriteFailure(inserted.error?.message, inserted.error?.code) ??
        "That memory wasn't saved.",
      saved: false,
    };
  }

  if (photo && photoPath) {
    const bytes = new ArrayBuffer(photo.value.bytes.byteLength);
    new Uint8Array(bytes).set(photo.value.bytes);
    const uploaded = await session.supabase.storage
      .from(MEMORIES_BUCKET)
      .upload(photoPath, new Blob([bytes], { type: photo.value.contentType }), {
        contentType: photo.value.contentType,
        upsert: false,
      });
    if (uploaded.error) {
      console.error("Memory photo upload failed.", uploaded.error.message);
      await session.supabase.from("memories").delete().eq("id", id);
      return {
        error: uploaded.error.message.includes("hsummer_storage_quota")
          ? MEMORY_QUOTA_MESSAGE
          : UPLOAD_FAILED,
        saved: false,
      };
    }
  }

  if (
    parsed.value.visibility === "selected" &&
    parsed.value.viewerIds.length > 0
  ) {
    const viewers = await session.supabase.from("memory_viewers").insert(
      parsed.value.viewerIds.map((userId) => ({
        memory_id: id,
        circle_id: circleId,
        user_id: userId,
      })),
    );
    if (viewers.error) {
      console.error("Memory viewers failed.", viewers.error.code);
      await forgetMemory(session, id, photoPath);
      return {
        error:
          memoryWriteFailure(viewers.error.message, viewers.error.code) ??
          "Pick people who are still in this circle.",
        saved: false,
      };
    }
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

/** Removes one of your memories and its photo. */
export async function deleteMemory(
  _previous: MemoryActionState,
  formData: FormData,
): Promise<MemoryActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const id = stringField(formData.get("id"));
  const circleId = stringField(formData.get("circleId"));
  if (!id || !isCircleId(id) || !circleId || !isCircleId(circleId)) {
    return { error: "That memory isn't on the wall.", saved: false };
  }

  const removed = await session.supabase
    .from("memories")
    .delete()
    .eq("id", id)
    .eq("circle_id", circleId)
    .select("id, photo_path");

  if (removed.error) {
    console.error("Memory delete failed.", removed.error.code);
    return {
      error:
        memoryWriteFailure(removed.error.message, removed.error.code) ??
        "That memory wasn't removed.",
      saved: false,
    };
  }
  if (!removed.data || removed.data.length === 0) {
    return { error: "You can't remove that memory.", saved: false };
  }

  const path = removed.data[0]?.photo_path;
  if (path) {
    await session.supabase.storage.from(MEMORIES_BUCKET).remove([path]);
  }

  revalidatePath(`/circles/${circleId}`);
  return { error: null, saved: true };
}

async function forgetMemory(
  session: Session,
  id: string,
  photoPath: string | null,
): Promise<void> {
  await session.supabase.from("memories").delete().eq("id", id);
  if (photoPath) {
    await session.supabase.storage.from(MEMORIES_BUCKET).remove([photoPath]);
  }
}

function stringField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
