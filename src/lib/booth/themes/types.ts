/**
 * A theme is a file: palette, type, padding, and how to draw its stickers.
 * The compositor does not switch on the theme id. A later theme is a new
 * file added to the list.
 */

import type { BoothTheme } from "@/lib/booth/fields";
import type { Slot } from "@/lib/booth/layout";

export type ThemeDecor = {
  width: number;
  height: number;
  slots: readonly Slot[];
};

export type ThemeBundle = {
  id: BoothTheme;
  label: string;
  blurb: string;
  background: string;
  ink: string;
  mutedInk: string;
  accent: string;
  slotFill: string;
  slotStroke: string;
  padding: number;
  header: number;
  footer: number;
  gap: number;
  radius: number;
  strokeWidth: number;
  font: "sans" | "serif";
  title: string;
  decorate?: (context: CanvasRenderingContext2D, spec: ThemeDecor) => void;
};
