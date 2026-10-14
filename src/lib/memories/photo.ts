/**
 * Sniffs a photo and removes the metadata segments that carry location,
 * camera, and author fields. The image pixels stay. A file we cannot parse
 * is refused, so a truncated JPEG is not stored with its EXIF still attached.
 */

import {
  MEMORY_MAX_BYTES,
  PHOTO_ERROR,
  type MemoryPhoto,
} from "@/lib/memories/fields";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const JPEG_STRIP = new Set<number>([
  0xe1, // APP1: EXIF and XMP
  0xed, // APP13: IPTC
  0xfe, // COM
]);

const PNG_STRIP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

export function sniffMemoryPhoto(bytes: Uint8Array): Parsed<MemoryPhoto> {
  if (bytes.byteLength === 0 || bytes.byteLength > MEMORY_MAX_BYTES) {
    return { ok: false, error: PHOTO_ERROR };
  }

  const stripped = stripImageMetadata(bytes);
  if (
    !stripped ||
    stripped.byteLength === 0 ||
    stripped.byteLength > MEMORY_MAX_BYTES
  ) {
    return { ok: false, error: PHOTO_ERROR };
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
  return { ok: false, error: PHOTO_ERROR };
}

/** JPEG, PNG, or WebP with metadata segments removed. Null when parsing fails. */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array | null {
  if (isJpeg(bytes)) return stripJpeg(bytes);
  if (isPng(bytes)) return stripPng(bytes);
  if (isWebp(bytes)) return stripWebp(bytes);
  return null;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

export function isPng(bytes: Uint8Array): boolean {
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

export function isWebp(bytes: Uint8Array): boolean {
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

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  let sawScan = false;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let markerIndex = i + 1;
    while (markerIndex < bytes.length && bytes[markerIndex] === 0xff) {
      markerIndex += 1;
    }
    if (markerIndex >= bytes.length) return null;
    const marker = bytes[markerIndex]!;
    const headerAt = markerIndex - 1;
    i = markerIndex + 1;

    if (marker === 0xd9) {
      parts.push(bytes.subarray(headerAt, i));
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(headerAt, i));
      continue;
    }

    if (i + 2 > bytes.length) return null;
    const segmentLength = (bytes[i]! << 8) | bytes[i + 1]!;
    if (segmentLength < 2 || i + segmentLength > bytes.length) return null;
    const segmentEnd = i + segmentLength;

    if (marker === 0xda) {
      parts.push(bytes.subarray(headerAt));
      sawScan = true;
      break;
    }

    if (!JPEG_STRIP.has(marker)) {
      parts.push(bytes.subarray(headerAt, segmentEnd));
    }
    i = segmentEnd;
  }

  if (!sawScan) return null;
  return concat(parts);
}

function stripPng(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;

  while (i + 12 <= bytes.length) {
    const length = readUint32(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    if (length < 0) return null;
    const chunkEnd = i + 12 + length;
    if (chunkEnd > bytes.length) return null;
    if (!PNG_STRIP.has(type)) {
      parts.push(bytes.subarray(i, chunkEnd));
    }
    i = chunkEnd;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }

  if (!sawEnd) return null;
  return concat(parts);
}

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  const chunks: { type: string; data: Uint8Array }[] = [];
  let i = 12;

  while (i + 8 <= bytes.length) {
    const type = ascii(bytes, i, 4);
    const size = readUint32LE(bytes, i + 4);
    if (size < 0) return null;
    const dataEnd = i + 8 + size;
    if (dataEnd > bytes.length) return null;
    const data = bytes.subarray(i + 8, dataEnd);
    if (type !== "EXIF" && type !== "XMP ") {
      let payload = data;
      if (type === "VP8X" && data.length >= 1) {
        const copy = new Uint8Array(data);
        // Bits 4 and 5 are the EXIF and XMP feature flags.
        copy[0] = copy[0]! & ~0x30;
        payload = copy;
      }
      chunks.push({ type, data: payload });
    }
    i = dataEnd + (size % 2);
  }

  if (chunks.length === 0) return null;

  let payloadSize = 4;
  for (const chunk of chunks) {
    payloadSize += 8 + chunk.data.length + (chunk.data.length % 2);
  }

  const out = new Uint8Array(8 + payloadSize);
  out.set(textBytes("RIFF"), 0);
  writeUint32LE(out, 4, payloadSize);
  out.set(textBytes("WEBP"), 8);
  let offset = 12;
  for (const chunk of chunks) {
    out.set(textBytes(chunk.type), offset);
    writeUint32LE(out, offset + 4, chunk.data.length);
    out.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.length;
    if (chunk.data.length % 2 === 1) offset += 1;
  }
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

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(bytes[offset + i]!);
  }
  return text;
}

function textBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i);
  }
  return out;
}
