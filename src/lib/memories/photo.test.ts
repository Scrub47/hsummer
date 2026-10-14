import { describe, expect, it } from "vitest";

import { MEMORY_MAX_BYTES } from "@/lib/memories/fields";
import { sniffMemoryPhoto, stripImageMetadata } from "@/lib/memories/photo";

describe("memory photo metadata", () => {
  it("removes JPEG EXIF and keeps the scan", () => {
    const scan = new Uint8Array([0x11, 0x22, 0x33, 0xff, 0x00, 0x44]);
    const original = jpegWithExif(text("Exif\0\0GPSLatitude"), scan);
    expect(textOf(original)).toContain("GPSLatitude");

    const stripped = stripImageMetadata(original);
    expect(stripped).not.toBeNull();
    expect(stripped![0]).toBe(0xff);
    expect(stripped![1]).toBe(0xd8);
    expect(textOf(stripped!)).not.toContain("Exif");
    expect(textOf(stripped!)).not.toContain("GPSLatitude");
    expect(includes(stripped!, scan)).toBe(true);
    expect(stripImageMetadata(stripped!)).toEqual(stripped);
  });

  it("removes PNG text and WebP EXIF chunks", () => {
    const png = pngWithText();
    expect(textOf(png)).toContain("Comment");
    const strippedPng = stripImageMetadata(png);
    expect(strippedPng).not.toBeNull();
    expect(textOf(strippedPng!)).not.toContain("Comment");
    expect(textOf(strippedPng!)).toContain("IHDR");
    expect(textOf(strippedPng!)).toContain("IDAT");

    const webp = webpWithExif();
    expect(textOf(webp)).toContain("GPSLatitude");
    const strippedWebp = stripImageMetadata(webp);
    expect(strippedWebp).not.toBeNull();
    expect(textOf(strippedWebp!)).not.toContain("GPSLatitude");
    expect(textOf(strippedWebp!)).toContain("VP8 ");
    expect(strippedWebp![20]! & 0x30).toBe(0);
  });

  it("refuses a file that is not a JPEG, PNG, or WebP, and one that is too large", () => {
    expect(sniffMemoryPhoto(new Uint8Array([0x47, 0x49, 0x46, 0x38])).ok).toBe(
      false,
    );
    expect(sniffMemoryPhoto(new Uint8Array(MEMORY_MAX_BYTES + 1)).ok).toBe(
      false,
    );

    const png = pngWithText();
    const sniffed = sniffMemoryPhoto(png);
    expect(sniffed.ok).toBe(true);
    if (!sniffed.ok) return;
    expect(sniffed.value.extension).toBe("png");
    expect(sniffed.value.contentType).toBe("image/png");
    expect(textOf(sniffed.value.bytes)).not.toContain("Comment");
  });

  it("keeps a real one-pixel PNG decodable as PNG", () => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const sniffed = sniffMemoryPhoto(new Uint8Array(pixel));
    expect(sniffed.ok).toBe(true);
    if (!sniffed.ok) return;
    expect(sniffed.value.bytes[0]).toBe(0x89);
    expect(sniffed.value.extension).toBe("png");
  });
});

function jpegWithExif(exif: Uint8Array, scan: Uint8Array): Uint8Array {
  const length = exif.length + 2;
  const app1 = new Uint8Array(4 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (length >> 8) & 0xff;
  app1[3] = length & 0xff;
  app1.set(exif, 4);
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x02]);
  const eoi = new Uint8Array([0xff, 0xd9]);
  return concat([new Uint8Array([0xff, 0xd8]), app1, sos, scan, eoi]);
}

function pngWithText(): Uint8Array {
  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = chunk("IHDR", new Uint8Array(13));
  const textChunk = chunk("tEXt", text("Comment\0hello"));
  const idat = chunk("IDAT", text("data"));
  const iend = chunk("IEND", new Uint8Array(0));
  return concat([signature, ihdr, textChunk, idat, iend]);
}

function webpWithExif(): Uint8Array {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x10;
  const exif = text("GPSLatitude");
  const image = text("img!");
  const chunks = [
    webpChunk("VP8X", vp8x),
    webpChunk("EXIF", exif),
    webpChunk("VP8 ", image),
  ];
  const payload = concat([text("WEBP"), ...chunks]);
  const header = new Uint8Array(8);
  header.set(text("RIFF"), 0);
  writeUint32LE(header, 4, payload.length);
  return concat([header, payload]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out.set(text(type), 4);
  out.set(data, 8);
  return out;
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(text(type), 0);
  writeUint32LE(out, 4, data.length);
  out.set(data, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function text(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function textOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function includes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return textOf(haystack).includes(textOf(needle));
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
