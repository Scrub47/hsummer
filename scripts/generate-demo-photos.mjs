/**
 * Draws the fictional demo pictures. Flat shapes only: a kitchen, a bowl,
 * a night train, four booth frames, and two monogram marks. No people.
 *
 *   node scripts/generate-demo-photos.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "public/demo-media");

const CREAM = hex("#f7f0e8");
const BURGUNDY = hex("#6e2236");
const CARAMEL = hex("#c48955");
const DEEP = hex("#8c5a34");
const BLUSH = hex("#f3d8d2");
const INK = hex("#3e1622");
const CARD = hex("#fffaf6");
const SKY = hex("#d7e4ea");
const NIGHT = hex("#243044");
const GOLD = hex("#e6c27a");
const LEAF = hex("#6e8f62");
const LEAF_DARK = hex("#3f5c3a");
const BROTH = hex("#e2a84a");
const EGG = hex("#f4e3a1");

function hex(value) {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function canvas(width, height, color) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return {
    width,
    height,
    data,
    set(x, y, color) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || py < 0 || px >= width || py >= height) return;
      const i = (py * width + px) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    },
  };
}

function fillRect(image, x, y, w, h, color) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) image.set(px, py, color);
  }
}

function fillCircle(image, cx, cy, r, color) {
  const r2 = r * r;
  for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py += 1) {
    for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) image.set(px, py, color);
    }
  }
}

function fillEllipse(image, cx, cy, rx, ry, color) {
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
      const dx = (px - cx) / rx;
      const dy = (py - cy) / ry;
      if (dx * dx + dy * dy <= 1) image.set(px, py, color);
    }
  }
}

function png(image) {
  const { width, height, data } = image;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    data.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  return buffer;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc;
}

function kitchen() {
  const image = canvas(800, 600, CREAM);
  fillRect(image, 70, 70, 420, 300, SKY);
  fillRect(image, 50, 50, 460, 24, BURGUNDY);
  fillRect(image, 50, 50, 24, 340, BURGUNDY);
  fillRect(image, 486, 50, 24, 340, BURGUNDY);
  fillRect(image, 50, 366, 460, 24, BURGUNDY);
  fillRect(image, 268, 74, 18, 292, CARD);
  fillRect(image, 74, 200, 412, 14, CARD);
  fillRect(image, 560, 430, 180, 24, DEEP);
  fillCircle(image, 650, 400, 70, CARAMEL);
  fillRect(image, 620, 330, 24, 50, DEEP);
  fillEllipse(image, 180, 470, 70, 28, LEAF_DARK);
  fillCircle(image, 150, 430, 48, LEAF);
  fillCircle(image, 210, 400, 36, LEAF);
  fillCircle(image, 190, 450, 22, LEAF_DARK);
  return image;
}

function ramen() {
  const image = canvas(800, 600, BLUSH);
  fillRect(image, 0, 380, 800, 220, DEEP);
  fillEllipse(image, 400, 340, 250, 90, CARD);
  fillEllipse(image, 400, 330, 210, 70, BROTH);
  fillCircle(image, 340, 310, 36, EGG);
  fillCircle(image, 460, 320, 18, BURGUNDY);
  fillCircle(image, 500, 300, 14, LEAF);
  fillCircle(image, 300, 300, 12, LEAF_DARK);
  fillRect(image, 560, 180, 16, 180, INK);
  fillRect(image, 590, 180, 16, 180, INK);
  return image;
}

function train() {
  const image = canvas(800, 600, NIGHT);
  fillRect(image, 80, 70, 640, 420, hex("#1a2433"));
  fillRect(image, 60, 50, 680, 22, CARAMEL);
  fillRect(image, 60, 50, 22, 460, CARAMEL);
  fillRect(image, 718, 50, 22, 460, CARAMEL);
  fillRect(image, 60, 488, 680, 22, CARAMEL);
  const lights = [
    [140, 140, 70, 110],
    [240, 180, 50, 90],
    [320, 120, 90, 160],
    [440, 200, 40, 70],
    [510, 150, 80, 130],
    [620, 190, 46, 80],
  ];
  for (const [x, y, w, h] of lights) fillRect(image, x, y, w, h, GOLD);
  fillRect(image, 80, 400, 640, 8, hex("#3d4d63"));
  return image;
}

function boothMug() {
  const image = canvas(480, 640, CREAM);
  fillRect(image, 150, 470, 180, 28, DEEP);
  fillCircle(image, 230, 360, 110, CARAMEL);
  fillRect(image, 200, 250, 28, 70, DEEP);
  fillCircle(image, 360, 340, 36, BURGUNDY);
  return image;
}

function boothSkyline() {
  const image = canvas(480, 640, SKY);
  fillRect(image, 0, 430, 480, 210, NIGHT);
  fillRect(image, 40, 250, 70, 180, BURGUNDY);
  fillRect(image, 130, 180, 90, 250, INK);
  fillRect(image, 240, 280, 60, 150, DEEP);
  fillRect(image, 320, 140, 80, 290, BURGUNDY);
  fillRect(image, 150, 210, 16, 16, GOLD);
  fillRect(image, 180, 250, 16, 16, GOLD);
  fillRect(image, 340, 180, 16, 16, GOLD);
  fillRect(image, 370, 230, 16, 16, GOLD);
  return image;
}

function boothPlant() {
  const image = canvas(480, 640, BLUSH);
  fillRect(image, 170, 400, 140, 120, DEEP);
  fillRect(image, 150, 390, 180, 24, CARAMEL);
  fillCircle(image, 200, 300, 70, LEAF);
  fillCircle(image, 280, 260, 56, LEAF_DARK);
  fillCircle(image, 250, 330, 40, LEAF);
  return image;
}

function boothTicket() {
  const image = canvas(480, 640, CREAM);
  fillRect(image, 70, 180, 340, 280, CARD);
  fillRect(image, 70, 180, 340, 36, BURGUNDY);
  fillRect(image, 100, 260, 200, 16, BLUSH);
  fillRect(image, 100, 300, 140, 16, BLUSH);
  fillRect(image, 100, 340, 220, 16, CARAMEL);
  fillCircle(image, 70, 320, 28, CREAM);
  fillCircle(image, 410, 320, 28, CREAM);
  return image;
}

function mark(primary, secondary) {
  const image = canvas(256, 256, CREAM);
  fillCircle(image, 128, 128, 108, primary);
  fillCircle(image, 78, 70, 36, primary);
  fillCircle(image, 178, 70, 36, primary);
  fillCircle(image, 128, 142, 48, secondary);
  fillCircle(image, 108, 128, 8, INK);
  fillCircle(image, 148, 128, 8, INK);
  return image;
}

const files = [
  ["kitchen.png", kitchen()],
  ["ramen.png", ramen()],
  ["train.png", train()],
  ["booth-0.png", boothMug()],
  ["booth-1.png", boothSkyline()],
  ["booth-2.png", boothPlant()],
  ["booth-3.png", boothTicket()],
  ["avatar-alex.png", mark(BURGUNDY, BLUSH)],
  ["avatar-jordan.png", mark(NIGHT, GOLD)],
];

mkdirSync(outDir, { recursive: true });
for (const [name, image] of files) {
  const bytes = png(image);
  writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name} ${bytes.length}`);
}
