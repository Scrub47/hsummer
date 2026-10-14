import { stripImageMetadata } from "@/lib/memories/photo";
import {
  AVATAR_ERROR,
  AVATAR_MAX_BYTES,
  type AvatarImage,
} from "@/lib/profile/fields";

/**
 * Bytes that are safe to put in the private avatars bucket. Location and
 * camera tags are removed. The profile form does not import this file, so
 * the parser stays out of the browser bundle. The form draws HEIC and JPEG
 * through a canvas first. This is the backstop.
 */
export function avatarForStorage(
  image: AvatarImage,
): { ok: true; value: AvatarImage } | { ok: false; error: string } {
  const stripped = stripImageMetadata(image.bytes);
  if (
    !stripped ||
    stripped.byteLength === 0 ||
    stripped.byteLength > AVATAR_MAX_BYTES
  ) {
    return { ok: false, error: AVATAR_ERROR };
  }
  return {
    ok: true,
    value: { ...image, bytes: stripped },
  };
}
