/**
 * Shrinks a photo the phone handed us, and turns an iPhone HEIC (or a JPEG
 * that is only upright because of EXIF) into a plain JPEG. Drawing through
 * a canvas drops the orientation tag by baking the pixels. The server strips
 * metadata again, and it still refuses a file that is the wrong type or too
 * large.
 *
 * A PNG or WebP that is already under the cap is left alone. Re-encoding
 * those is unnecessary, and the one-pixel PNG used in tests has to stay a PNG.
 *
 * This module is for the browser. It is not imported from server code.
 */

import { MEMORY_MAX_BYTES, PHOTO_ERROR } from "@/lib/memories/fields";

export async function prepareMemoryPhoto(
  file: File,
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  return prepareBrowserImage(file, MEMORY_MAX_BYTES, PHOTO_ERROR);
}

export async function prepareBrowserImage(
  file: File,
  maxBytes: number,
  error: string,
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: true, file };

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const pngOrWebp = isPng(header) || isWebp(header);
  if (pngOrWebp && file.size <= maxBytes) return { ok: true, file };

  if (!canDraw()) {
    if (isJpeg(header) && file.size <= maxBytes) return { ok: true, file };
    return { ok: false, error };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(
      1,
      maxEdge / Math.max(bitmap.width, bitmap.height, 1),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return { ok: false, error };
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = 0.85;
    let blob: Blob | null = null;
    while (quality >= 0.5) {
      blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (blob && blob.size > 0 && blob.size <= maxBytes) break;
      quality = Math.round((quality - 0.15) * 100) / 100;
    }

    if (!blob || blob.size === 0 || blob.size > maxBytes) {
      return { ok: false, error };
    }
    return {
      ok: true,
      file: new File([blob], "photo.jpg", { type: "image/jpeg" }),
    };
  } catch {
    return { ok: false, error };
  }
}

function canDraw(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  );
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
    bytes[3] === 0x47
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}
