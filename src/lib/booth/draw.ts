/**
 * Draws one strip from slot images and a theme bundle.
 *
 * This is the browser compositor. The saved files are the slots, not this
 * canvas. The wall draws it again from those files and the theme.
 */

import {
  STRIP_HEIGHT,
  STRIP_WIDTH,
  type BoothLayout,
} from "@/lib/booth/fields";
import { coverCrop, frameSlots } from "@/lib/booth/layout";
import type { ThemeBundle } from "@/lib/booth/themes/types";

export function canvasFontFamily(role: "sans" | "serif"): string {
  if (typeof document === "undefined") {
    return role === "serif" ? "serif" : "sans-serif";
  }
  const variable = role === "serif" ? "--font-fraunces" : "--font-outfit";
  const name = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return name || (role === "serif" ? "serif" : "sans-serif");
}

export function drawStrip(
  context: CanvasRenderingContext2D,
  input: {
    theme: ThemeBundle;
    layout: BoothLayout;
    images: readonly (CanvasImageSource | null)[];
    dateLabel: string;
    fontFamily: string;
  },
): void {
  const { theme } = input;
  const slots = frameSlots(input.layout, theme);
  context.clearRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

  slots.forEach((slot, index) => {
    context.save();
    roundedPath(context, slot.x, slot.y, slot.width, slot.height, theme.radius);
    context.clip();
    context.fillStyle = theme.slotFill;
    context.fillRect(slot.x, slot.y, slot.width, slot.height);
    const image = input.images[index] ?? null;
    if (image) {
      const size = sourceSize(image);
      if (size.width > 0 && size.height > 0) {
        const crop = coverCrop(
          size.width,
          size.height,
          slot.width,
          slot.height,
        );
        context.drawImage(
          image,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          slot.x,
          slot.y,
          slot.width,
          slot.height,
        );
      }
    }
    context.restore();
    context.save();
    context.strokeStyle = theme.slotStroke;
    context.lineWidth = theme.strokeWidth;
    roundedPath(context, slot.x, slot.y, slot.width, slot.height, theme.radius);
    context.stroke();
    context.restore();
  });

  theme.decorate?.(context, {
    width: STRIP_WIDTH,
    height: STRIP_HEIGHT,
    slots,
  });

  context.fillStyle = theme.ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `600 ${theme.font === "serif" ? 52 : 64}px ${input.fontFamily}`;
  context.fillText(
    theme.title,
    STRIP_WIDTH / 2,
    theme.padding + theme.header / 2,
  );
  context.fillStyle = theme.mutedInk;
  context.font = `500 26px ${input.fontFamily}`;
  context.fillText(
    input.dateLabel,
    STRIP_WIDTH / 2,
    STRIP_HEIGHT - theme.padding - theme.footer / 2,
  );
}

function sourceSize(image: CanvasImageSource): {
  width: number;
  height: number;
} {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  if (image instanceof SVGImageElement) return { width: 0, height: 0 };
  if (
    "width" in image &&
    "height" in image &&
    typeof image.width === "number" &&
    typeof image.height === "number"
  ) {
    return { width: image.width, height: image.height };
  }
  return { width: 0, height: 0 };
}

function roundedPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
