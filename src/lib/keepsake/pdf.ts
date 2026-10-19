/**
 * A small PDF for a memory book. Text uses the standard Helvetica face.
 * JPEG photos and strip frames are embedded as-is, so the bytes are not
 * re-encoded. The printable page is the handwritten layout.
 */

export type KeepsakeImage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
};

export type KeepsakePage = {
  heading: string;
  lines: string[];
};

const PAGE_W = 612;
const PAGE_H = 792;

export function jpegSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const length = ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = ((bytes[offset + 5] ?? 0) << 8) + (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) + (bytes[offset + 8] ?? 0);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

export function buildKeepsakePdf(input: {
  title: string;
  pages: { page: KeepsakePage; images: KeepsakeImage[] }[];
}): Uint8Array {
  const pages =
    input.pages.length > 0
      ? input.pages
      : [{ page: { heading: input.title, lines: [] }, images: [] }];

  let next = 1;
  const fontId = next++;
  const planned = pages.map((item) => {
    const imageIds = item.images.map(() => next++);
    const contentId = next++;
    const pageId = next++;
    return { item, imageIds, contentId, pageId };
  });
  const pagesId = next++;
  const catalogId = next++;
  const objects: Array<Uint8Array | null> = Array.from(
    { length: next },
    () => null,
  );
  const put = (id: number, body: string | Uint8Array) => {
    objects[id] = typeof body === "string" ? latin(body) : body;
  };

  put(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const plan of planned) {
    plan.item.images.forEach((image, index) => {
      const id = plan.imageIds[index];
      if (id == null) return;
      put(id, imageObject(image.jpeg, image.width, image.height));
    });
    put(plan.contentId, contentObject(plan.item.page, plan.imageIds.length));
    const xobjects = plan.imageIds
      .map((id, index) => `/Im${index} ${id} 0 R`)
      .join(" ");
    put(
      plan.pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << ${xobjects} >> >> /Contents ${plan.contentId} 0 R >>`,
    );
  }
  const kids = planned.map((plan) => `${plan.pageId} 0 R`).join(" ");
  put(pagesId, `<< /Type /Pages /Count ${planned.length} /Kids [${kids}] >>`);
  put(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const header = latin("%PDF-1.4\n");
  const chunks: Uint8Array[] = [header];
  const offsets = [0];
  let cursor = header.length;
  for (let id = 1; id < objects.length; id += 1) {
    offsets.push(cursor);
    const body = objects[id] ?? latin("<<>>");
    const prefix = latin(`${id} 0 obj\n`);
    const suffix = latin("\nendobj\n");
    chunks.push(prefix, body, suffix);
    cursor += prefix.length + body.length + suffix.length;
  }
  const xrefAt = cursor;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(latin(xref));
  return concat(chunks);
}

function contentObject(page: KeepsakePage, imageCount: number): Uint8Array {
  const lines = [page.heading, ...page.lines].flatMap((line) => wrap(line, 78));
  const commands = [
    "0.97 0.94 0.91 rg",
    `0 0 ${PAGE_W} ${PAGE_H} re f`,
    "0.24 0.09 0.13 rg",
    "BT /F1 18 Tf 54 740 Td",
    `(${pdfText(lines[0] ?? "")}) Tj`,
  ];
  let y = 710;
  for (const line of lines.slice(1, 28)) {
    y -= 16;
    commands.push(`0 -16 Td (${pdfText(line)}) Tj`);
  }
  commands.push("ET");
  let imageTop = Math.max(180, y - 24);
  for (let index = 0; index < imageCount; index += 1) {
    const height = Math.min(220, imageTop - 54);
    if (height < 40) break;
    const width = 320;
    imageTop -= height + 12;
    commands.push(
      `q ${width} 0 0 ${height} 54 ${imageTop} cm /Im${index} Do Q`,
    );
  }
  const stream = commands.join("\n");
  return latin(
    `<< /Length ${latin(stream).length} >>\nstream\n${stream}\nendstream`,
  );
}

function imageObject(
  jpeg: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const header = latin(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  const footer = latin("\nendstream");
  return concat([header, jpeg, footer]);
}

function wrap(line: string, width: number): string[] {
  const clean = winAnsi(line);
  if (clean.length <= width) return [clean];
  const words = clean.split(/\s+/);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) rows.push(current);
  return rows.length > 0 ? rows : [""];
}

function winAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 126 ? char : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

function pdfText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function latin(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
