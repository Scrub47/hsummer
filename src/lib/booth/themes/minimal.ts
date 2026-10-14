import type { ThemeBundle } from "@/lib/booth/themes/types";

/**
 * Warm paper, a serif name, and a thin rule. No stickers. The frames are
 * almost square-cornered so the photos do the talking.
 */
export const minimal: ThemeBundle = {
  id: "minimal",
  label: "Minimal",
  blurb: "Warm paper, a thin rule, and no stickers.",
  background: "#f7f4ef",
  ink: "#1c1915",
  mutedInk: "#5c564c",
  accent: "#234237",
  slotFill: "#fffaf3",
  slotStroke: "#1c1915",
  padding: 48,
  header: 120,
  footer: 80,
  gap: 28,
  radius: 2,
  strokeWidth: 2,
  font: "serif",
  title: "Hsummer",
  decorate(context, spec) {
    const top = spec.slots[0];
    context.strokeStyle = "#1c1915";
    context.lineWidth = 2;
    context.strokeRect(18, 18, spec.width - 36, spec.height - 36);
    if (!top) return;
    context.beginPath();
    context.moveTo(top.x, top.y - 16);
    context.lineTo(top.x + top.width, top.y - 16);
    context.stroke();
  },
};
