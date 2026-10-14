/**
 * Pixel filters for one slot. They run on the slot-sized frame, after the
 * crop, so a 12 megapixel camera photo is not filtered at full size.
 *
 * Grain uses the pixel index, not Math.random, so the same photo filters to
 * the same JPEG.
 */

import type { BoothFilter } from "@/lib/booth/fields";

export function applyFilter(
  pixels: Uint8ClampedArray,
  filter: BoothFilter,
): void {
  if (filter === "none") return;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    const next = filtered(red, green, blue, filter, index);
    pixels[index] = next.red;
    pixels[index + 1] = next.green;
    pixels[index + 2] = next.blue;
  }
}

function filtered(
  red: number,
  green: number,
  blue: number,
  filter: BoothFilter,
  index: number,
): { red: number; green: number; blue: number } {
  if (filter === "bw") {
    const tone = clamp(0.299 * red + 0.587 * green + 0.114 * blue);
    return { red: tone, green: tone, blue: tone };
  }
  if (filter === "sepia") {
    return {
      red: clamp(0.393 * red + 0.769 * green + 0.189 * blue),
      green: clamp(0.349 * red + 0.686 * green + 0.168 * blue),
      blue: clamp(0.272 * red + 0.534 * green + 0.131 * blue),
    };
  }
  if (filter === "warm") {
    return {
      red: clamp(red * 1.08),
      green: clamp(green * 1.02),
      blue: clamp(blue * 0.9),
    };
  }
  if (filter === "cool") {
    return {
      red: clamp(red * 0.9),
      green: clamp(green),
      blue: clamp(blue * 1.12),
    };
  }
  if (filter === "grain") {
    const delta = (((index * 1103515245 + 12345) >>> 0) % 41) - 20;
    return {
      red: clamp(red + delta),
      green: clamp(green + delta),
      blue: clamp(blue + delta),
    };
  }
  return { red, green, blue };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
