import type { BoothTheme } from "@/lib/booth/fields";
import { kawaii } from "@/lib/booth/themes/kawaii";
import { minimal } from "@/lib/booth/themes/minimal";
import type { ThemeBundle } from "@/lib/booth/themes/types";

export const BOOTH_THEME_BUNDLES: readonly ThemeBundle[] = [kawaii, minimal];

const byId = new Map(BOOTH_THEME_BUNDLES.map((theme) => [theme.id, theme]));

export function themeBundle(id: BoothTheme): ThemeBundle {
  return byId.get(id) ?? kawaii;
}

export type { ThemeBundle };
