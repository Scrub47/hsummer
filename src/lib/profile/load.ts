import "server-only";

import {
  AVATARS_BUCKET,
  AVATAR_SIGNED_URL_SECONDS,
  isDisplayableAvatarUrl,
  isOwnAvatarObjectPath,
} from "@/lib/profile/fields";
import type { Session } from "@/lib/supabase/session";

export type OwnProfile = {
  displayName: string;
  timezone: string;
  avatarUrl: string | null;
  hasAvatar: boolean;
};

/**
 * The signed-in user's own profile. Returns null when the row is missing
 * (the week 1 migration has not been applied) or the read failed.
 *
 * Avatar bytes stay in the private bucket. This returns a signed URL, or the
 * legacy https provider URL the week 1 trigger stored, or null.
 */
export async function loadOwnProfile(
  session: Session,
): Promise<OwnProfile | null> {
  const { data, error } = await session.supabase
    .from("profiles")
    .select("display_name, avatar_path, timezone")
    .eq("id", session.userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    displayName: data.display_name,
    timezone: data.timezone,
    hasAvatar: data.avatar_path !== null,
    avatarUrl: await avatarUrl(session, data.avatar_path),
  };
}

async function avatarUrl(
  session: Session,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  if (isDisplayableAvatarUrl(path) && path.startsWith("https://")) return path;
  if (!isOwnAvatarObjectPath(session.userId, path)) return null;

  const { data, error } = await session.supabase.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(path, AVATAR_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl || !isDisplayableAvatarUrl(data.signedUrl)) {
    return null;
  }
  return data.signedUrl;
}
