import { describe, expect, it } from "vitest";

import { buildKeepsakePdf, jpegSize } from "@/lib/keepsake/pdf";

describe("memory book pdf", () => {
  it("starts with a PDF header and keeps parentheses out of the text operators", () => {
    const pdf = buildKeepsakePdf({
      title: "Us",
      pages: [
        {
          page: {
            heading: "Ferry (Bainbridge)",
            lines: ["A note with (parentheses) and a \\ slash."],
          },
          images: [],
        },
      ],
    });
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("\\(parentheses\\)");
    expect(text).toContain("%%EOF");
    expect(text).not.toContain("<script");
  });

  it("reads the size from a JPEG frame", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
    ]);
    expect(jpegSize(jpeg)).toEqual({ width: 32, height: 16 });
    expect(jpegSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
