import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const getSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/session", () => ({
  getSession,
}));

import { BOOTH_JPEG_ERROR } from "@/lib/booth/fields";

import { saveSoloBooth, type BoothActionState } from "./booth-actions";

const circleId = "11111111-1111-4111-8111-111111111111";
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const previous: BoothActionState = { error: null, saved: false };

describe("saveSoloBooth", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("strips EXIF, then records the session and uploads each frame", async () => {
    const uploads: { path: string; bytes: Uint8Array }[] = [];
    const calls: unknown[] = [];
    getSession.mockResolvedValue(
      session(calls, uploads, {
        data: {
          session_id: sessionId,
          memory_id: memoryId,
          paths: [0, 1, 2, 3].map(
            (position) => `${circleId}/${sessionId}/${position}.jpg`,
          ),
        },
        error: null,
      }),
    );

    const data = form();
    const original = jpegWithExif();
    for (let index = 0; index < 4; index += 1) {
      data.append(
        "shot",
        new File([Buffer.from(original)], `shot-${index}.jpg`, {
          type: "image/jpeg",
        }),
      );
    }

    const result = await saveSoloBooth(previous, data);
    expect(result).toEqual({ error: null, saved: true });
    expect(calls[0]).toMatchObject({
      target_circle: circleId,
      target_theme: "kawaii",
      target_layout: "4-cut",
      target_filter: "none",
      target_caption: "Ferry",
    });
    expect(uploads).toHaveLength(4);
    expect(Buffer.from(uploads[0]!.bytes).toString("latin1")).not.toContain(
      "GPSLatitude",
    );
    expect(uploads[0]?.path).toBe(`${circleId}/${sessionId}/0.jpg`);
  });

  it("reads a JPEG blob that is not a File", async () => {
    const uploads: { path: string; bytes: Uint8Array }[] = [];
    getSession.mockResolvedValue(
      session([], uploads, {
        data: {
          session_id: sessionId,
          memory_id: memoryId,
          paths: [
            `${circleId}/${sessionId}/0.jpg`,
            `${circleId}/${sessionId}/1.jpg`,
          ],
        },
        error: null,
      }),
    );
    const data = form({ layout: "2-cut" });
    const jpeg = jpegWithExif();
    const blob = new Blob([Buffer.from(jpeg)], { type: "image/jpeg" });
    expect(blob instanceof File).toBe(false);
    data.getAll = ((name: string) =>
      name === "shot"
        ? [blob, blob]
        : FormData.prototype.getAll.call(data, name)) as FormData["getAll"];

    const result = await saveSoloBooth(previous, data);
    expect(result).toEqual({ error: null, saved: true });
    expect(uploads).toHaveLength(2);
  });

  it("does not call the database when a shot is not a JPEG", async () => {
    const calls: unknown[] = [];
    getSession.mockResolvedValue(
      session(calls, [], { data: null, error: null }),
    );
    const data = form();
    const jpeg = jpegWithExif();
    for (let index = 0; index < 3; index += 1) {
      data.append(
        "shot",
        new File([Buffer.from(jpeg)], `shot-${index}.jpg`, {
          type: "image/jpeg",
        }),
      );
    }
    data.append(
      "shot",
      new File([Buffer.from([0x47, 0x49, 0x46])], "a.gif", {
        type: "image/gif",
      }),
    );
    const result = await saveSoloBooth(previous, data);
    expect(result).toEqual({ error: BOOTH_JPEG_ERROR, saved: false });
    expect(calls).toEqual([]);
  });

  it("deletes the memory when an upload fails", async () => {
    const removed: string[] = [];
    getSession.mockResolvedValue(
      session(
        [],
        [],
        {
          data: {
            session_id: sessionId,
            memory_id: memoryId,
            paths: [
              `${circleId}/${sessionId}/0.jpg`,
              `${circleId}/${sessionId}/1.jpg`,
            ],
          },
          error: null,
        },
        removed,
        { message: "bucket down" },
      ),
    );
    const data = form({ layout: "2-cut" });
    const jpeg = jpegWithExif();
    data.append(
      "shot",
      new File([Buffer.from(jpeg)], "a.jpg", { type: "image/jpeg" }),
    );
    data.append(
      "shot",
      new File([Buffer.from(jpeg)], "b.jpg", { type: "image/jpeg" }),
    );
    const result = await saveSoloBooth(previous, data);
    expect(result.saved).toBe(false);
    expect(removed).toContain(memoryId);
  });
});

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("circleId", circleId);
  data.set("theme", "kawaii");
  data.set("layout", "4-cut");
  data.set("filter", "none");
  data.set("caption", "Ferry");
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

function session(
  calls: unknown[],
  uploads: { path: string; bytes: Uint8Array }[],
  rpcResult: {
    data: unknown;
    error: { message: string; code?: string } | null;
  },
  removed: string[] = [],
  uploadError: { message: string } | null = null,
) {
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    supabase: {
      rpc: async (_name: string, args: unknown) => {
        calls.push(args);
        return rpcResult;
      },
      from() {
        return {
          delete() {
            const builder = {
              eq(_column: string, id: string) {
                removed.push(id);
                return Promise.resolve({ data: null, error: null });
              },
            };
            return builder;
          },
        };
      },
      storage: {
        from() {
          return {
            upload: async (path: string, body: Blob) => {
              uploads.push({
                path,
                bytes: new Uint8Array(await body.arrayBuffer()),
              });
              return { error: uploadError };
            },
            remove: async () => ({ error: null }),
          };
        },
      },
    },
  };
}

function jpegWithExif(): Uint8Array {
  const exif = Uint8Array.from("Exif\0\0GPSLatitude", (char) =>
    char.charCodeAt(0),
  );
  const length = exif.length + 2;
  const app1 = new Uint8Array(4 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (length >> 8) & 0xff;
  app1[3] = length & 0xff;
  app1.set(exif, 4);
  return concat([
    new Uint8Array([0xff, 0xd8]),
    app1,
    new Uint8Array([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]),
  ]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
