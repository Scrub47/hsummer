import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  appleStartupImages,
  appleTouchIcon,
  favicon32,
  icon192,
} from "@/lib/brand/icons";

function pngSize(file: string) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const root = process.cwd();

describe("logo icons", () => {
  it("resizes the committed logo instead of redrawing it", async () => {
    const source = path.join(root, "public/brand/logo-source.png");
    const icon = path.join(root, "public/icons/icon-512-v2.png");
    expect(pngSize(icon)).toEqual({ width: 512, height: 512 });
    expect(
      pngSize(path.join(root, "public/icons/apple-touch-icon-v2.png")),
    ).toEqual({
      width: 180,
      height: 180,
    });
    expect(pngSize(path.join(root, "public/icons/icon-192-v2.png"))).toEqual({
      width: 192,
      height: 192,
    });
    expect(
      pngSize(path.join(root, "public/icons/icon-512-maskable-v2.png")),
    ).toEqual({
      width: 512,
      height: 512,
    });
    expect(pngSize(path.join(root, "public/icons/favicon-32-v2.png"))).toEqual({
      width: 32,
      height: 32,
    });

    const resized = await sharp(source)
      .resize(512, 512, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const shipped = await sharp(icon).ensureAlpha().raw().toBuffer();
    expect(shipped.length).toBe(resized.length);
    const samples = [0, 100, 512 * 256 + 256, resized.length - 4];
    for (const index of samples) {
      expect(shipped.subarray(index, index + 3)).toEqual(
        resized.subarray(index, index + 3),
      );
    }

    const ico = readFileSync(path.join(root, "public/icons/favicon-v2.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
  });

  it("points the manifest, the notification, and the bear at the versioned files", () => {
    const manifest = readFileSync(
      path.join(root, "src/app/manifest.ts"),
      "utf8",
    );
    const worker = readFileSync(path.join(root, "public/sw.js"), "utf8");
    const bear = readFileSync(
      path.join(root, "src/components/bear-mark.tsx"),
      "utf8",
    );
    expect(manifest).toContain("icon192");
    expect(manifest).toContain("icon512");
    expect(manifest).toContain("icon192Maskable");
    expect(manifest).toContain("icon512Maskable");
    expect(manifest).not.toContain('"/icons/icon-192.png"');
    expect(worker).toContain(icon192);
    expect(bear).toContain("logoMarkLarge");
    expect(bear).toContain("logoMarkSmall");
    expect(favicon32.endsWith("-v2.png")).toBe(true);
    expect(appleTouchIcon.endsWith("-v2.png")).toBe(true);
    for (const image of appleStartupImages) {
      const file = path.join(root, "public", image.url);
      const size = pngSize(file);
      expect(size.width).toBeGreaterThan(1000);
      expect(size.height).toBeGreaterThan(size.width);
    }
  });
});
