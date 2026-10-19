/**
 * Resize public/brand/logo-source.png into the PWA icons.
 * The script only scales that file. It does not redraw it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public/brand/logo-source.png");
const VERSION = "v2";

const SPLASHES = [
  [1170, 2532],
  [1179, 2556],
  [1206, 2622],
  [1290, 2796],
  [1320, 2868],
];

async function background() {
  const { data } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2], alpha: 1 };
}

async function exactPng(size, dest) {
  await sharp(SOURCE)
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

async function exactWebp(size, dest) {
  await sharp(SOURCE)
    .resize(size, size, { fit: "fill" })
    .webp({ quality: 82 })
    .toFile(dest);
}

async function padded(size, dest, bg, scale) {
  const inner = Math.round(size * scale);
  const logo = await sharp(SOURCE)
    .resize(inner, inner, { fit: "fill" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([
    header,
    ...entries,
    ...images.map((image) => image.png),
  ]);
}

async function splash(width, height, dest, bg) {
  const side = Math.round(Math.min(width, height) * 0.62);
  const logo = await sharp(SOURCE)
    .resize(side, side, { fit: "fill" })
    .png()
    .toBuffer();
  await sharp({
    create: { width, height, channels: 4, background: bg },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

async function main() {
  const bg = await background();
  const icons = path.join(ROOT, "public/icons");
  const brand = path.join(ROOT, "public/brand");
  await mkdir(icons, { recursive: true });
  await mkdir(brand, { recursive: true });

  const pngs = [
    [180, path.join(icons, `apple-touch-icon-${VERSION}.png`)],
    [192, path.join(icons, `icon-192-${VERSION}.png`)],
    [512, path.join(icons, `icon-512-${VERSION}.png`)],
    [32, path.join(icons, `favicon-32-${VERSION}.png`)],
    [512, path.join(brand, `logo-512-${VERSION}.png`)],
  ];
  for (const [size, dest] of pngs) {
    await exactPng(size, dest);
    console.log(path.relative(ROOT, dest), size);
  }

  for (const size of [192, 512]) {
    const dest = path.join(icons, `icon-${size}-maskable-${VERSION}.png`);
    await padded(size, dest, bg, 0.8);
    console.log(path.relative(ROOT, dest), "maskable");
  }

  for (const size of [512, 256, 128, 64]) {
    const dest = path.join(brand, `logo-${size}-${VERSION}.webp`);
    await exactWebp(size, dest);
    console.log(path.relative(ROOT, dest));
  }

  const icoImages = [];
  for (const size of [16, 32, 48]) {
    const png = await sharp(SOURCE)
      .resize(size, size, { fit: "fill" })
      .png()
      .toBuffer();
    icoImages.push({ size, png });
  }
  const icoPath = path.join(icons, `favicon-${VERSION}.ico`);
  await writeFile(icoPath, ico(icoImages));
  console.log(path.relative(ROOT, icoPath));

  for (const [width, height] of SPLASHES) {
    const dest = path.join(
      icons,
      `apple-splash-${width}x${height}-${VERSION}.png`,
    );
    await splash(width, height, dest, bg);
    console.log(path.relative(ROOT, dest));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
