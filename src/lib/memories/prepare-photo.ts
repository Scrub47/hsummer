/**
 * Shrinks a photo the phone handed us when it is over the 2 MB cap.
 * Decoding through a canvas also drops EXIF. The server strips metadata
 * again, and it still refuses a file that is the wrong type or too large.
 *
 * This module is for the browser. It is not imported from server code.
 */

import { MEMORY_MAX_BYTES, PHOTO_ERROR } from "@/lib/memories/fields";

export async function prepareMemoryPhoto(
  file: File,
): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: true, file };
  if (file.size <= MEMORY_MAX_BYTES) return { ok: true, file };
  if (typeof createImageBitmap !== "function") {
    return { ok: false, error: PHOTO_ERROR };
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
      return { ok: false, error: PHOTO_ERROR };
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = 0.85;
    let blob: Blob | null = null;
    while (quality >= 0.5) {
      blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (blob && blob.size > 0 && blob.size <= MEMORY_MAX_BYTES) break;
      quality = Math.round((quality - 0.15) * 100) / 100;
    }

    if (!blob || blob.size === 0 || blob.size > MEMORY_MAX_BYTES) {
      return { ok: false, error: PHOTO_ERROR };
    }
    return {
      ok: true,
      file: new File([blob], "memory.jpg", { type: "image/jpeg" }),
    };
  } catch {
    return { ok: false, error: PHOTO_ERROR };
  }
}
