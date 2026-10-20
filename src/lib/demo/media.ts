/**
 * Drawings in public/demo-media. The reset script uploads these bytes.
 * The local preview maps the same names onto /demo-media so the wall and
 * the strip can render without Storage.
 */

export const DEMO_MEDIA_FILES = {
  kitchen: "kitchen.png",
  ramen: "ramen.png",
  train: "train.png",
  "booth-0": "booth-0.png",
  "booth-1": "booth-1.png",
  "booth-2": "booth-2.png",
  "booth-3": "booth-3.png",
  "avatar-alex": "avatar-alex.png",
  "avatar-jordan": "avatar-jordan.png",
} as const;

export type DemoMediaName = keyof typeof DEMO_MEDIA_FILES;

export function demoMediaFile(name: string): string | null {
  if (Object.prototype.hasOwnProperty.call(DEMO_MEDIA_FILES, name)) {
    return DEMO_MEDIA_FILES[name as DemoMediaName];
  }
  return null;
}
