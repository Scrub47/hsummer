import type { ThemeBundle } from "@/lib/booth/themes/types";

const blush = "#e7b7c6";
const berry = "#c4556a";
const cream = "#fff6f8";

/**
 * Soft paper, round frames, and a few hearts in the margin. Stickers stay
 * outside the photo slots so they never cover a face.
 */
export const kawaii: ThemeBundle = {
  id: "kawaii",
  label: "Kawaii",
  blurb: "Pink paper, round frames, and small hearts.",
  background: cream,
  ink: "#5c3140",
  mutedInk: "#8a5364",
  accent: berry,
  slotFill: "#ffe4ec",
  slotStroke: blush,
  padding: 36,
  header: 150,
  footer: 110,
  gap: 18,
  radius: 28,
  strokeWidth: 6,
  font: "sans",
  title: "hsummer",
  decorate(context, spec) {
    context.fillStyle = blush;
    heart(context, 28, spec.height * 0.42, 16);
    heart(context, spec.width - 28, spec.height * 0.58, 14);
    context.fillStyle = berry;
    heart(context, spec.width / 2 - 78, 58, 12);
    star(context, spec.width / 2 + 86, 62, 8, "#e7b7c6");
    star(context, 52, spec.height - 48, 7, berry);
  },
};

function heart(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  context.beginPath();
  context.moveTo(x, y + size * 0.35);
  context.bezierCurveTo(
    x - size * 0.7,
    y - size * 0.15,
    x - size * 0.35,
    y - size * 0.7,
    x,
    y - size * 0.2,
  );
  context.bezierCurveTo(
    x + size * 0.35,
    y - size * 0.7,
    x + size * 0.7,
    y - size * 0.15,
    x,
    y + size * 0.35,
  );
  context.fill();
}

function star(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  context.fillStyle = color;
  context.beginPath();
  for (let point = 0; point < 5; point += 1) {
    const angle = -Math.PI / 2 + (point * 2 * Math.PI) / 5;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
    const inner = angle + Math.PI / 5;
    context.lineTo(
      x + Math.cos(inner) * radius * 0.45,
      y + Math.sin(inner) * radius * 0.45,
    );
  }
  context.closePath();
  context.fill();
}
