import { describe, expect, it } from "vitest";

import { unzipStore, zipStore } from "@/lib/export/zip";

describe("zipStore", () => {
  it("round-trips JSON and a file without compressing them", () => {
    const json = new TextEncoder().encode('{"hello":"hsummer"}');
    const photo = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const archive = zipStore([
      { name: "export.json", data: json },
      { name: "files/memories/circle/photo.jpg", data: photo },
    ]);

    const entries = unzipStore(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "export.json",
      "files/memories/circle/photo.jpg",
    ]);
    expect(entries[0]?.data).toEqual(json);
    expect(entries[1]?.data).toEqual(photo);
  });

  it("refuses a path that could leave the archive", () => {
    expect(() =>
      zipStore([{ name: "../secret.txt", data: new Uint8Array([1]) }]),
    ).toThrow(/not safe/);
  });
});
