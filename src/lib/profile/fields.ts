/**
 * Profile field rules shared by the profile form, the server action, and the
 * unit tests. The database constraints are the backstop; this module rejects
 * the same shapes before we talk to Supabase.
 *
 * Email is not a field. A display name that contains "@" is rejected so an
 * address cannot land on `profiles`.
 */

import { z } from "zod";

import { stripImageMetadata } from "@/lib/memories/photo";

export const AVATARS_BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIGNED_URL_SECONDS = 60 * 60;

export const DISPLAY_NAME_ERROR =
  "Use a name up to 80 characters, without an email address.";
export const TIMEZONE_ERROR = "Choose a valid timezone.";
export const AVATAR_ERROR = "Use a JPEG, PNG, or WebP image up to 2 MB.";

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+/-]{1,64}$/;
const AVATAR_OBJECT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export type AvatarImage = {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export type ProfileEdit = {
  displayName: string;
  timezone: string;
  avatar: AvatarImage | "remove" | "keep";
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => [...value].length <= 80 && !value.includes("@"));

export function parseDisplayName(value: unknown): Parsed<string> {
  const parsed = displayNameSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: DISPLAY_NAME_ERROR };
  return { ok: true, value: parsed.data };
}

export function isIanaTimeZone(value: string): boolean {
  if (!TIMEZONE_PATTERN.test(value)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .refine((value) => isIanaTimeZone(value));

export function parseTimezone(value: unknown): Parsed<string> {
  const parsed = timezoneSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: TIMEZONE_ERROR };
  return { ok: true, value: parsed.data };
}

/** Browser zone, or null when the runtime cannot name one we can store. */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isIanaTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

export function supportedTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone").filter(isIanaTimeZone);
  // The profile default is UTC. Some runtimes omit it from supportedValuesOf
  // even though DateTimeFormat accepts it.
  if (zones.includes("UTC")) return zones;
  return ["UTC", ...zones];
}

export function sniffAvatar(bytes: Uint8Array): Parsed<AvatarImage> {
  if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, error: AVATAR_ERROR };
  }

  // Same strip as memory photos. A file we cannot parse is refused, so a
  // truncated JPEG is not stored with its EXIF still attached.
  const stripped = stripImageMetadata(bytes);
  if (
    !stripped ||
    stripped.byteLength === 0 ||
    stripped.byteLength > AVATAR_MAX_BYTES
  ) {
    return { ok: false, error: AVATAR_ERROR };
  }

  if (isJpeg(stripped)) {
    return {
      ok: true,
      value: {
        bytes: stripped,
        contentType: "image/jpeg",
        extension: "jpg",
      },
    };
  }
  if (isPng(stripped)) {
    return {
      ok: true,
      value: { bytes: stripped, contentType: "image/png", extension: "png" },
    };
  }
  if (isWebp(stripped)) {
    return {
      ok: true,
      value: {
        bytes: stripped,
        contentType: "image/webp",
        extension: "webp",
      },
    };
  }
  return { ok: false, error: AVATAR_ERROR };
}

export function isAvatarObjectPath(path: string): boolean {
  return AVATAR_OBJECT_PATTERN.test(path);
}

export function isOwnAvatarObjectPath(userId: string, path: string): boolean {
  return isAvatarObjectPath(path) && path.startsWith(`${userId}/`);
}

export function newAvatarObjectPath(
  userId: string,
  extension: AvatarImage["extension"],
): string {
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

/** https provider URLs and http(s) signed URLs. Rejects javascript: and credentials. */
export function isDisplayableAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function profileEditFromForm(input: {
  displayName: unknown;
  timezone: unknown;
  removeAvatar: boolean;
  file: Uint8Array | null;
}): { ok: true; value: ProfileEdit } | { ok: false; error: string } {
  const displayName = parseDisplayName(input.displayName);
  if (!displayName.ok) return displayName;
  const timezone = parseTimezone(input.timezone);
  if (!timezone.ok) return timezone;

  if (input.removeAvatar) {
    return {
      ok: true,
      value: {
        displayName: displayName.value,
        timezone: timezone.value,
        avatar: "remove",
      },
    };
  }

  if (!input.file) {
    return {
      ok: true,
      value: {
        displayName: displayName.value,
        timezone: timezone.value,
        avatar: "keep",
      },
    };
  }

  const avatar = sniffAvatar(input.file);
  if (!avatar.ok) return avatar;
  return {
    ok: true,
    value: {
      displayName: displayName.value,
      timezone: timezone.value,
      avatar: avatar.value,
    },
  };
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}
