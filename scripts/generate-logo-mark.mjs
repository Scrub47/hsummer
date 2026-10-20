/**
 * Derive public/brand/logo-mark.png from public/brand/logo-source.png.
 *
 * The square behind the bear is a flat burgundy field. Pixels of that field
 * that touch the edge become transparent. Every other pixel keeps the source
 * red, green, and blue, so the bear artwork itself is not redrawn.
 * App icons and Home Screen splash images stay on logo-source.png.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public/brand/logo-source.png");
const DEST = path.join(ROOT, "public/brand/logo-mark.png");

const BACKGROUND = [84, 1, 22];
const THRESHOLD = 18;

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function decodePng(bytes) {
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("logo-source.png is not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
    }
    if (type === "IDAT") idat.push(chunk);
    offset += 12 + length;
  }
  if (colorType !== 2) throw new Error("logo-source.png is not RGB");
  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, rows: unfilter(raw, width, height, 3) };
}

function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const rows = [];
  let previous = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    if (filter === 1) {
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= channels ? row[index - channels] : 0;
        row[index] = (row[index] + left) & 255;
      }
    } else if (filter === 2) {
      for (let index = 0; index < row.length; index += 1) {
        row[index] = (row[index] + previous[index]) & 255;
      }
    } else if (filter === 3) {
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= channels ? row[index - channels] : 0;
        row[index] = (row[index] + ((left + previous[index]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= channels ? row[index - channels] : 0;
        const up = previous[index];
        const upLeft = index >= channels ? previous[index - channels] : 0;
        row[index] = (row[index] + paeth(left, up, upLeft)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    previous = row;
  }
  return rows;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    raw[start] = 0;
    rgba.copy(raw, start + 1, y * stride, (y + 1) * stride);
  }
  const compressed = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  function chunk(type, payload) {
    const body = Buffer.concat([Buffer.from(type), payload]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([header, body, crc]);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function knockOut(rows, width, height) {
  const background = new Uint8Array(width * height);
  const queue = [];
  function push(x, y) {
    const index = y * width + x;
    if (background[index]) return;
    background[index] = 1;
    queue.push(index);
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    const pixel = x * 3;
    const row = rows[y];
    const distance = Math.max(
      Math.abs(row[pixel] - BACKGROUND[0]),
      Math.abs(row[pixel + 1] - BACKGROUND[1]),
      Math.abs(row[pixel + 2] - BACKGROUND[2]),
    );
    if (distance > THRESHOLD) continue;
    background[index] = 2;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const source = x * 3;
      const dest = (y * width + x) * 4;
      rgba[dest] = row[source];
      rgba[dest + 1] = row[source + 1];
      rgba[dest + 2] = row[source + 2];
      rgba[dest + 3] = background[y * width + x] === 2 ? 0 : 255;
    }
  }
  return rgba;
}

const decoded = decodePng(readFileSync(SOURCE));
const rgba = knockOut(decoded.rows, decoded.width, decoded.height);
await writeFile(DEST, encodePng(decoded.width, decoded.height, rgba));
console.log(
  `wrote ${path.relative(ROOT, DEST)} ${decoded.width}x${decoded.height}`,
);
