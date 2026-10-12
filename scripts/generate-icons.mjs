/**
 * Draws the placeholder PWA icons: two overlapping circles on warm paper.
 * Run with `node scripts/generate-icons.mjs` if you want to regenerate them.
 * The PNGs are committed so the app does not depend on this script at build time.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PAPER = [0xf3, 0xec, 0xdf];
const TERRACOTTA = [0xc4, 0x55, 0x2a];
const PINE = [0x23, 0x42, 0x37];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function mix(base, color, amount) {
  return [
    Math.round(base[0] + (color[0] - base[0]) * amount),
    Math.round(base[1] + (color[1] - base[1]) * amount),
    Math.round(base[2] + (color[2] - base[2]) * amount),
  ];
}

function coverage(distance, radius, antialias) {
  if (distance <= radius - antialias) return 1;
  if (distance >= radius + antialias) return 0;
  return 1 - (distance - (radius - antialias)) / (antialias * 2);
}

function paint(x, y, size) {
  const antialias = 1.25 / size;
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const left = coverage(Math.hypot(nx - 0.4, ny - 0.54), 0.2, antialias);
  const right = coverage(Math.hypot(nx - 0.6, ny - 0.46), 0.2, antialias);
  let color = PAPER;
  color = mix(color, TERRACOTTA, left);
  color = mix(color, PINE, right);
  return color;
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y, size);
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePng(file, size) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size));
}

writePng("public/icons/icon-192.png", 192);
writePng("public/icons/icon-512.png", 512);
writePng("public/icons/apple-touch-icon.png", 180);
writePng("src/app/icon.png", 32);
writePng("src/app/apple-icon.png", 180);

console.log("Wrote placeholder icons.");
