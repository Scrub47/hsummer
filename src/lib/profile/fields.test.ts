import { describe, expect, it } from "vitest";

import {
  AVATAR_ERROR,
  AVATAR_MAX_BYTES,
  DISPLAY_NAME_ERROR,
  browserTimeZone,
  isDisplayableAvatarUrl,
  isIanaTimeZone,
  isOwnAvatarObjectPath,
  newAvatarObjectPath,
  parseDisplayName,
  parseTimezone,
  profileEditFromForm,
  sniffAvatar,
  supportedTimeZones,
} from "@/lib/profile/fields";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("parseDisplayName", () => {
  it("trims a normal name", () => {
    expect(parseDisplayName("  Ada  ")).toEqual({ ok: true, value: "Ada" });
  });

  it("rejects an email address, a blank name, and a name past 80 characters", () => {
    expect(parseDisplayName("ada@example.com")).toEqual({
      ok: false,
      error: DISPLAY_NAME_ERROR,
    });
    expect(parseDisplayName("   ")).toEqual({
      ok: false,
      error: DISPLAY_NAME_ERROR,
    });
    expect(parseDisplayName("a".repeat(81)).ok).toBe(false);
    expect(parseDisplayName("a".repeat(80))).toEqual({
      ok: true,
      value: "a".repeat(80),
    });
  });
});

describe("parseTimezone", () => {
  it("accepts every zone the browser can offer", () => {
    for (const zone of supportedTimeZones()) {
      expect(parseTimezone(zone)).toEqual({ ok: true, value: zone });
    }
    expect(supportedTimeZones()).toContain("America/Los_Angeles");
    expect(supportedTimeZones()).toContain("UTC");
  });

  it("rejects zones that are not IANA names", () => {
    expect(parseTimezone("ada@example.com").ok).toBe(false);
    expect(parseTimezone("Not/AZone").ok).toBe(false);
    expect(parseTimezone("").ok).toBe(false);
    expect(isIanaTimeZone("A".repeat(65))).toBe(false);
  });

  it("reads a browser zone the database constraint can store", () => {
    const zone = browserTimeZone();
    expect(zone).not.toBeNull();
    if (zone) expect(isIanaTimeZone(zone)).toBe(true);
  });
});

describe("sniffAvatar", () => {
  it("accepts a png, strips JPEG EXIF, and rejects a file it cannot parse", () => {
    expect(sniffAvatar(PNG)).toMatchObject({
      ok: true,
      value: { contentType: "image/png", extension: "png" },
    });

    const exif = new TextEncoder().encode("GPSLatitude");
    const length = exif.length + 2;
    const jpeg = new Uint8Array(2 + 4 + exif.length + 4);
    jpeg.set([0xff, 0xd8, 0xff, 0xe1, (length >> 8) & 0xff, length & 0xff], 0);
    jpeg.set(exif, 6);
    jpeg.set([0xff, 0xda, 0x00, 0x02], 6 + exif.length);
    const sniffed = sniffAvatar(jpeg);
    expect(sniffed.ok).toBe(true);
    if (!sniffed.ok) return;
    expect(sniffed.value.extension).toBe("jpg");
    expect(Buffer.from(sniffed.value.bytes).toString("latin1")).not.toContain(
      "GPSLatitude",
    );

    expect(sniffAvatar(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])).ok).toBe(
      false,
    );
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffAvatar(webp).ok).toBe(false);

    expect(sniffAvatar(new TextEncoder().encode("<html></html>"))).toEqual({
      ok: false,
      error: AVATAR_ERROR,
    });
    expect(sniffAvatar(new TextEncoder().encode("GIF89a")).ok).toBe(false);
    expect(sniffAvatar(new Uint8Array(AVATAR_MAX_BYTES + 1)).ok).toBe(false);
    expect(sniffAvatar(new Uint8Array()).ok).toBe(false);
  });
});

describe("avatar paths", () => {
  it("builds an object path the owner can store", () => {
    const path = newAvatarObjectPath(USER_ID, "png");
    expect(isOwnAvatarObjectPath(USER_ID, path)).toBe(true);
    expect(
      isOwnAvatarObjectPath("22222222-2222-4222-8222-222222222222", path),
    ).toBe(false);
  });

  it("allows https and signed http urls, and rejects other schemes", () => {
    expect(
      isDisplayableAvatarUrl("https://lh3.googleusercontent.com/a/photo"),
    ).toBe(true);
    expect(
      isDisplayableAvatarUrl(
        "http://127.0.0.1:54321/storage/v1/object/sign/avatars/a",
      ),
    ).toBe(true);
    expect(isDisplayableAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isDisplayableAvatarUrl("https://user:pass@example.com/a")).toBe(
      false,
    );
  });
});

describe("profileEditFromForm", () => {
  it("keeps the photo when no file is attached", () => {
    expect(
      profileEditFromForm({
        displayName: "Ada",
        timezone: "America/Los_Angeles",
        removeAvatar: false,
        file: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        displayName: "Ada",
        timezone: "America/Los_Angeles",
        avatar: "keep",
      },
    });
  });

  it("removes the photo even if a file was also attached", () => {
    const edit = profileEditFromForm({
      displayName: "Ada",
      timezone: "UTC",
      removeAvatar: true,
      file: PNG,
    });
    expect(edit).toMatchObject({ ok: true, value: { avatar: "remove" } });
  });

  it("rejects a display name that is an email before looking at the file", () => {
    const edit = profileEditFromForm({
      displayName: "ada@example.com",
      timezone: "UTC",
      removeAvatar: false,
      file: PNG,
    });
    expect(edit).toEqual({ ok: false, error: DISPLAY_NAME_ERROR });
  });
});
