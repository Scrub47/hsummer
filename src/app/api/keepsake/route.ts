import { NextResponse } from "next/server";
import { z } from "zod";

import { isBoothShotPath } from "@/lib/booth/fields";
import { isCircleId } from "@/lib/bucket/fields";
import { loadCircle } from "@/lib/circles/load";
import {
  buildKeepsakePdf,
  jpegSize,
  type KeepsakeImage,
} from "@/lib/keepsake/pdf";
import { MEMORIES_BUCKET, isMemoryPhotoPath } from "@/lib/memories/fields";
import { loadMemories } from "@/lib/memories/load";
import { getSession } from "@/lib/supabase/session";

const bodySchema = z.object({
  circleId: z.string().refine(isCircleId),
  ids: z.array(z.string().uuid()).min(1).max(40),
});

/**
 * A PDF of the memories this person can already see. Ids they cannot read
 * are dropped by the memory query before anything is drawn.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a few memories." },
      { status: 400 },
    );
  }

  const circle = await loadCircle(session, parsed.data.circleId);
  if (!circle) {
    return NextResponse.json(
      { error: "The memory book isn't ready." },
      { status: 404 },
    );
  }
  const names = new Map(
    circle.members.map((member) => [member.userId, member.displayName]),
  );
  const loaded = await loadMemories(session, parsed.data.circleId, names);
  if (!loaded.ok) {
    return NextResponse.json(
      { error: "The memory book isn't ready." },
      { status: 503 },
    );
  }

  const wanted = new Set(parsed.data.ids);
  const chosen = loaded.wall.memories.filter((memory) => wanted.has(memory.id));
  if (chosen.length === 0) {
    return NextResponse.json(
      { error: "Those memories aren't available." },
      { status: 404 },
    );
  }

  const pages = [];
  for (const memory of chosen) {
    const images: KeepsakeImage[] = [];
    if (memory.photoPath && isMemoryPhotoPath(memory.photoPath)) {
      const image = await loadJpeg(session, memory.photoPath);
      if (image) images.push(image);
    }
    if (memory.booth) {
      const shots = await session.supabase
        .from("booth_shots")
        .select("position, storage_path")
        .eq("session_id", memory.booth.sessionId);
      for (const shot of shots.data ?? []) {
        if (!isBoothShotPath(shot.storage_path)) continue;
        const image = await loadJpeg(session, shot.storage_path);
        if (image) images.push(image);
      }
    }
    pages.push({
      page: {
        heading: memory.author,
        lines: [
          memory.occurredOn,
          memory.body ??
            (memory.kind === "photo-strip" ? "Photo booth strip" : ""),
        ].filter((line) => line.length > 0),
      },
      images: images.slice(0, 4),
    });
  }

  const pdf = buildKeepsakePdf({ title: "Hsummer", pages });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="hsummer-memory-book.pdf"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function loadJpeg(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  path: string,
): Promise<KeepsakeImage | null> {
  const file = await session.supabase.storage
    .from(MEMORIES_BUCKET)
    .download(path);
  if (file.error || !file.data) return null;
  const jpeg = new Uint8Array(await file.data.arrayBuffer());
  const size = jpegSize(jpeg);
  if (!size) return null;
  return { jpeg, width: size.width, height: size.height };
}
