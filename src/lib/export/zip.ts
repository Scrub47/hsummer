/**
 * A stored (uncompressed) ZIP. Export uses this so the archive can be built
 * without another package. Image bytes are already compressed.
 */

export type ZipEntry = {
  name: string;
  data: Uint8Array;
};

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = zipName(entry.name);
    const crc = crc32(entry.data);
    const local = localHeader(name, entry.data, crc);
    locals.push(local);
    centrals.push(centralHeader(name, entry.data, crc, offset));
    offset += local.byteLength;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const end = endHeader(entries.length, centralSize, offset);
  return concat([...locals, ...centrals, end]);
}

/** Reads stored entries back out. Used by the unit test. */
export function unzipStore(
  archive: Uint8Array,
): { name: string; data: Uint8Array }[] {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const found: { name: string; data: Uint8Array }[] = [];
  let cursor = 0;

  while (cursor + 4 <= archive.byteLength) {
    const signature = view.getUint32(cursor, true);
    if (signature !== LOCAL) break;
    const method = view.getUint16(cursor + 8, true);
    const compressed = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const nameStart = cursor + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (method !== 0) throw new Error("Only stored ZIP entries are supported.");
    const name = new TextDecoder().decode(
      archive.subarray(nameStart, nameStart + nameLength),
    );
    found.push({
      name,
      data: archive.subarray(dataStart, dataStart + compressed),
    });
    cursor = dataStart + compressed;
  }

  return found;
}

function zipName(name: string): Uint8Array {
  if (
    name.length === 0 ||
    name.length > 200 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0")
  ) {
    throw new Error("ZIP entry name is not safe.");
  }
  return new TextEncoder().encode(name);
}

function localHeader(
  name: Uint8Array,
  data: Uint8Array,
  crc: number,
): Uint8Array {
  const header = new Uint8Array(30 + name.byteLength + data.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, name.byteLength, true);
  header.set(name, 30);
  header.set(data, 30 + name.byteLength);
  return header;
}

function centralHeader(
  name: Uint8Array,
  data: Uint8Array,
  crc: number,
  offset: number,
): Uint8Array {
  const header = new Uint8Array(46 + name.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function endHeader(
  count: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, END, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return header;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[index] = crc;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const mixed = (crc ^ byte) & 0xff;
    crc = CRC_TABLE[mixed]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
