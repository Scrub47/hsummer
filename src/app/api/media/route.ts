import { NextResponse } from "next/server";
import { z } from "zod";

import { isBoothShotPath } from "@/lib/booth/fields";
import { MEMORIES_BUCKET, isMemoryPhotoPath } from "@/lib/memories/fields";
import { getSession } from "@/lib/supabase/session";

const querySchema = z.object({
  memoryId: z.string().uuid(),
  position: z.coerce.number().int().min(0).max(7).optional(),
});

/**
 * Same-origin bytes for a photo or one frame of a strip. The signed-in
 * person's storage policies decide whether the file exists for them.
 * The wall uses this so a strip can be saved as an image without a
 * cross-origin canvas.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    memoryId: url.searchParams.get("memoryId"),
    position: url.searchParams.get("position") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That photo isn't available." },
      { status: 400 },
    );
  }

  const memory = await session.supabase
    .from("memories")
    .select("id, kind, photo_path, booth_session_id")
    .eq("id", parsed.data.memoryId)
    .maybeSingle();
  if (memory.error || !memory.data) {
    return NextResponse.json(
      { error: "That photo isn't available." },
      { status: 404 },
    );
  }

  let path: string | null = null;
  if (parsed.data.position != null) {
    if (!memory.data.booth_session_id) {
      return NextResponse.json(
        { error: "That photo isn't available." },
        { status: 404 },
      );
    }
    const shot = await session.supabase
      .from("booth_shots")
      .select("storage_path")
      .eq("session_id", memory.data.booth_session_id)
      .eq("position", parsed.data.position)
      .maybeSingle();
    path = shot.data?.storage_path ?? null;
    if (!path || !isBoothShotPath(path)) {
      return NextResponse.json(
        { error: "That photo isn't available." },
        { status: 404 },
      );
    }
  } else {
    path = memory.data.photo_path;
    if (!path || !isMemoryPhotoPath(path)) {
      return NextResponse.json(
        { error: "That photo isn't available." },
        { status: 404 },
      );
    }
  }

  const file = await session.supabase.storage
    .from(MEMORIES_BUCKET)
    .download(path);
  if (file.error || !file.data) {
    return NextResponse.json(
      { error: "That photo isn't available." },
      { status: 404 },
    );
  }

  const bytes = new Uint8Array(await file.data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "content-type": file.data.type || "image/jpeg",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
