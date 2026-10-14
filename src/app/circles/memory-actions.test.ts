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

import { MEMORY_RATE_LIMIT_MESSAGE } from "@/lib/memories/fields";

import { addMemory, type MemoryActionState } from "./memory-actions";

const circleId = "11111111-1111-4111-8111-111111111111";
const selfId = "22222222-2222-4222-8222-222222222222";
const partnerId = "33333333-3333-4333-8333-333333333333";
const previous: MemoryActionState = { error: null, saved: false };

describe("addMemory", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("stores a note and does not upload a photo", async () => {
    const uploads: string[] = [];
    const inserts: unknown[] = [];
    getSession.mockResolvedValue(session(inserts, uploads));

    const result = await addMemory(
      previous,
      form({
        circleId,
        body: "The ferry was late.",
        tags: "Summer",
        occurredOn: "2026-10-14",
        visibility: "circle",
      }),
    );

    expect(result).toEqual({ error: null, saved: true });
    expect(uploads).toEqual([]);
    expect(inserts[0]).toMatchObject({
      circle_id: circleId,
      kind: "note",
      body: "The ferry was late.",
      tags: ["summer"],
      photo_path: null,
      photo_bytes: 0,
      visibility: "circle",
    });
  });

  it("strips EXIF before the photo is uploaded", async () => {
    const uploads: Uint8Array[] = [];
    const inserts: { photo_bytes?: number; photo_path?: string }[] = [];
    getSession.mockResolvedValue(session(inserts, uploads));
    const original = jpegWithExif();

    const data = new FormData();
    data.set("circleId", circleId);
    data.set("body", "Dock");
    data.set("tags", "summer");
    data.set("occurredOn", "2026-10-14");
    data.set("visibility", "selected");
    data.append("viewer", partnerId);
    data.set(
      "photo",
      new File([Buffer.from(original)], "dock.jpg", { type: "image/jpeg" }),
    );

    const result = await addMemory(previous, data);
    expect(result).toEqual({ error: null, saved: true });
    expect(uploads).toHaveLength(1);
    expect(Buffer.from(uploads[0]!).toString("latin1")).not.toContain(
      "GPSLatitude",
    );
    expect(inserts[0]?.photo_bytes).toBe(uploads[0]!.byteLength);
    expect(inserts[0]?.photo_path).toMatch(/\.jpg$/);
    expect(inserts[1]).toEqual([
      expect.objectContaining({
        circle_id: circleId,
        user_id: partnerId,
      }),
    ]);
  });

  it("returns the rate-limit sentence when Postgres refuses the row", async () => {
    getSession.mockResolvedValue(
      session([], [], {
        data: null,
        error: { message: "hsummer_rate_limited", code: "P0001" },
      }),
    );
    const result = await addMemory(
      previous,
      form({
        circleId,
        body: "Again",
        occurredOn: "2026-10-14",
        visibility: "circle",
      }),
    );
    expect(result).toEqual({
      error: MEMORY_RATE_LIMIT_MESSAGE,
      saved: false,
    });
  });

  it("refuses a file that is not a photo", async () => {
    const inserts: unknown[] = [];
    getSession.mockResolvedValue(session(inserts, []));
    const data = form({
      circleId,
      body: "Nope",
      occurredOn: "2026-10-14",
      visibility: "circle",
    });
    data.set(
      "photo",
      new File([Buffer.from([0x47, 0x49, 0x46])], "a.gif", {
        type: "image/gif",
      }),
    );
    const result = await addMemory(previous, data);
    expect(result.saved).toBe(false);
    expect(inserts).toEqual([]);
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function session(
  inserts: unknown[],
  uploads: Array<Uint8Array | string>,
  insertResult: {
    data: unknown;
    error: { message: string; code?: string } | null;
  } = { data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, error: null },
) {
  return {
    userId: selfId,
    supabase: {
      from(table: string) {
        return {
          insert(payload: unknown) {
            inserts.push(payload);
            const result =
              table === "memories" ? insertResult : { data: null, error: null };
            return {
              select() {
                return {
                  single: async () => result,
                };
              },
              then(
                resolve: (value: typeof result) => unknown,
                reject?: (reason: unknown) => unknown,
              ) {
                return Promise.resolve(result).then(resolve, reject);
              },
            };
          },
          delete() {
            const builder = {
              eq() {
                return builder;
              },
              select() {
                return Promise.resolve({ data: [], error: null });
              },
              then(
                resolve: (value: { data: unknown; error: null }) => unknown,
                reject?: (reason: unknown) => unknown,
              ) {
                return Promise.resolve({ data: null, error: null }).then(
                  resolve,
                  reject,
                );
              },
            };
            return builder;
          },
        };
      },
      storage: {
        from() {
          return {
            upload: async (_path: string, body: Blob) => {
              uploads.push(new Uint8Array(await body.arrayBuffer()));
              return { error: null };
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
