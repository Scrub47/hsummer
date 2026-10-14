"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  AVATARS_BUCKET,
  isOwnAvatarObjectPath,
  newAvatarObjectPath,
  profileEditFromForm,
} from "@/lib/profile/fields";
import { avatarForStorage } from "@/lib/profile/stored-avatar";
import { getSession } from "@/lib/supabase/session";

export type ProfileFormState = {
  error: string | null;
  savedAt: number | null;
};

const MISSING_PROFILE =
  "Your profile isn't available yet. Apply the database migrations and try again.";
const UPLOAD_FAILED =
  "The photo couldn't be saved. Apply the week 2 SQL so the private avatars bucket exists, then try a JPEG, PNG, or WebP under 2 MB.";
const SAVE_FAILED = "Your profile couldn't be saved.";

/**
 * Saves the signed-in user's own profile. The user id comes from the verified
 * session, not from the form. RLS is the backstop: the update is filtered to
 * that id, and the avatar object is uploaded under that id's folder.
 */
export async function updateProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const attachment = formData.get("avatar");
  const file =
    attachment instanceof File && attachment.size > 0
      ? new Uint8Array(await attachment.arrayBuffer())
      : null;

  const edit = profileEditFromForm({
    displayName: formData.get("displayName"),
    timezone: formData.get("timezone"),
    removeAvatar: formData.get("intent") === "remove-photo",
    file,
  });
  if (!edit.ok) return { error: edit.error, savedAt: null };

  const { data: existing, error: loadError } = await session.supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", session.userId)
    .maybeSingle();

  if (loadError || !existing) {
    console.error("Profile load failed before update.");
    return { error: MISSING_PROFILE, savedAt: null };
  }

  let nextPath = existing.avatar_path;
  let uploadedPath: string | null = null;

  if (edit.value.avatar === "remove") {
    nextPath = null;
  } else if (edit.value.avatar !== "keep") {
    const stored = avatarForStorage(edit.value.avatar);
    if (!stored.ok) return { error: stored.error, savedAt: null };
    const image = stored.value;
    uploadedPath = newAvatarObjectPath(session.userId, image.extension);
    const bytes = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(bytes).set(image.bytes);
    const { error: uploadError } = await session.supabase.storage
      .from(AVATARS_BUCKET)
      .upload(uploadedPath, new Blob([bytes], { type: image.contentType }), {
        contentType: image.contentType,
        upsert: false,
      });
    if (uploadError) {
      console.error("Avatar upload failed.", uploadError.message);
      return { error: UPLOAD_FAILED, savedAt: null };
    }
    nextPath = uploadedPath;
  }

  const { data: updated, error: updateError } = await session.supabase
    .from("profiles")
    .update({
      display_name: edit.value.displayName,
      timezone: edit.value.timezone,
      avatar_path: nextPath,
    })
    .eq("id", session.userId)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    if (uploadedPath) {
      await session.supabase.storage
        .from(AVATARS_BUCKET)
        .remove([uploadedPath]);
    }
    console.error("Profile update failed.", updateError?.message ?? "no row");
    return { error: SAVE_FAILED, savedAt: null };
  }

  const previous = existing.avatar_path;
  if (
    previous &&
    previous !== nextPath &&
    isOwnAvatarObjectPath(session.userId, previous)
  ) {
    await session.supabase.storage.from(AVATARS_BUCKET).remove([previous]);
  }

  revalidatePath("/profile");
  revalidatePath("/home");
  return { error: null, savedAt: Date.now() };
}

/** Clears the signed-in user's photo and deletes the private object, if any. */
export async function removeProfilePhoto(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  void formData;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { data: existing, error: loadError } = await session.supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", session.userId)
    .maybeSingle();

  if (loadError || !existing) {
    console.error("Profile load failed before removing the photo.");
    return { error: MISSING_PROFILE, savedAt: null };
  }

  const { data: updated, error: updateError } = await session.supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", session.userId)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.error("Profile photo removal failed.");
    return { error: SAVE_FAILED, savedAt: null };
  }

  const previous = existing.avatar_path;
  if (previous && isOwnAvatarObjectPath(session.userId, previous)) {
    await session.supabase.storage.from(AVATARS_BUCKET).remove([previous]);
  }

  revalidatePath("/profile");
  revalidatePath("/home");
  return { error: null, savedAt: Date.now() };
}
