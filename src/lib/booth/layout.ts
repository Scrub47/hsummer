/**
 * Where each photo sits on a 600×1800 strip.
 *
 * The numbers come from the theme's padding, header, footer, and gap, so a
 * new theme file changes the frames without a change here. 4-cut is four
 * equal frames. 2-cut is two taller ones. Nothing overlaps, and the frames
 * stay inside the padding.
 */

import {
  STRIP_HEIGHT,
  STRIP_WIDTH,
  type BoothLayout,
} from "@/lib/booth/fields";

export type Slot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrameMetrics = {
  padding: number;
  header: number;
  footer: number;
  gap: number;
};

export function frameSlots(layout: BoothLayout, theme: FrameMetrics): Slot[] {
  const count = layout === "4-cut" ? 4 : 2;
  const width = STRIP_WIDTH - theme.padding * 2;
  const available =
    STRIP_HEIGHT -
    theme.padding * 2 -
    theme.header -
    theme.footer -
    theme.gap * (count - 1);
  const height = Math.floor(available / count);
  const slots: Slot[] = [];
  let y = theme.padding + theme.header;
  for (let index = 0; index < count; index += 1) {
    slots.push({ x: theme.padding, y, width, height });
    y += height + theme.gap;
  }
  return slots;
}

/**
 * Source rectangle that fills a slot without stretching. The leftover is
 * cropped equally from both sides. The preview is mirrored in CSS; this crop
 * is the unmirrored frame that gets saved.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  slotWidth: number,
  slotHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const safeWidth = Math.max(sourceWidth, 1);
  const safeHeight = Math.max(sourceHeight, 1);
  const scale = Math.max(slotWidth / safeWidth, slotHeight / safeHeight);
  const sw = slotWidth / scale;
  const sh = slotHeight / scale;
  return {
    sx: (safeWidth - sw) / 2,
    sy: (safeHeight - sh) / 2,
    sw,
    sh,
  };
}
