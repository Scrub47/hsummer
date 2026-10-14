import { describe, expect, it } from "vitest";

import { avatarForStorage } from "@/lib/profile/stored-avatar";

describe("avatarForStorage", () => {
  it("drops JPEG location data before the photo is stored", () => {
    const exif = text("Exif\0\0GPSLatitude");
    const length = exif.length + 2;
    const app1 = new Uint8Array(4 + exif.length);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1[2] = (length >> 8) & 0xff;
    app1[3] = length & 0xff;
    app1.set(exif, 4);
    const jpeg = concat([
      new Uint8Array([0xff, 0xd8]),
      app1,
      new Uint8Array([0xff, 0xda, 0x00, 0x02]),
      text("scan"),
      new Uint8Array([0xff, 0xd9]),
    ]);
    expect(Buffer.from(jpeg).toString("latin1")).toContain("GPSLatitude");

    const stored = avatarForStorage({
      bytes: jpeg,
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(Buffer.from(stored.value.bytes).toString("latin1")).not.toContain(
      "GPSLatitude",
    );
    expect(stored.value.contentType).toBe("image/jpeg");
  });
});

function text(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
