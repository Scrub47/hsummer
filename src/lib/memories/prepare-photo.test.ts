import { describe, expect, it } from "vitest";

import { PHOTO_ERROR } from "@/lib/memories/fields";
import { prepareBrowserImage } from "@/lib/memories/prepare-photo";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("prepareBrowserImage", () => {
  it("leaves a small PNG alone so it is still a PNG", async () => {
    const file = new File([PNG], "pixel.png", { type: "image/png" });
    const prepared = await prepareBrowserImage(
      file,
      2 * 1024 * 1024,
      PHOTO_ERROR,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.file).toBe(file);
  });

  it("refuses a phone photo it cannot draw when canvas is missing", async () => {
    const heic = new File(
      [new Uint8Array([0x00, 0x00, 0x00, 0x18])],
      "IMG.HEIC",
      {
        type: "image/heic",
      },
    );
    const prepared = await prepareBrowserImage(
      heic,
      2 * 1024 * 1024,
      PHOTO_ERROR,
    );
    expect(prepared).toEqual({ ok: false, error: PHOTO_ERROR });
  });
});
