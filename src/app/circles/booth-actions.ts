"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  BOOTH_JPEG_ERROR,
  BOOTH_RATE_LIMIT_MESSAGE,
  BOOTH_TOTAL_ERROR,
  BOOTH_TOTAL_MAX_BYTES,
  MEMORY_MAX_BYTES,
  boothWriteFailure,
  isBoothShotPath,
  parseBoothForm,
} from "@/lib/booth/fields";
import {
  MEMORY_LIMIT,
  MEMORY_QUOTA_MESSAGE,
  MEMORY_WINDOW_MINUTES,
  MEMORIES_BUCKET,
} from "@/lib/memories/fields";
import { sniffMemoryPhoto } from "@/lib/memories/photo";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession, type Session } from "@/lib/supabase/session";

export type BoothActionState = {
  error: string | null;
  saved: boolean;
};

const savedSchema = z.object({
  session_id: z.string().uuid(),
  memory_id: z.string().uuid(),
  paths: z.array(z.string()),
});

const UPLOAD_FAILED =
  "The strip couldn't be saved. Apply the week 13 SQL so the photo booth tables exist, then try again.";

function shotFiles(formData: FormData): File[] {
  return formData.getAll("shot").flatMap((value) => {
    if (typeof value === "string" || value.size <= 0) return [];
    if (value instanceof File) return [value];
    const type = value.type || "image/jpeg";
    return [new File([value], "shot.jpg", { type })];
  });
}

/**
 * Saves a finished Solo strip. The shots were taken in the browser. This is
 * the first write: one transaction for the session and the memory, then the
 * JPEGs. A failed upload deletes that memory, and the trigger deletes the
 * session and any frame that landed.
 */
export async function saveSoloBooth(
  _previous: BoothActionState,
  formData: FormData,
): Promise<BoothActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const files = shotFiles(formData);
  const parsed = parseBoothForm({
    circleId: formData.get("circleId"),
    theme: formData.get("theme"),
    layout: formData.get("layout"),
    filter: formData.get("filter"),
    caption: formData.get("caption"),
    shotCount: files.length,
  });
  if (!parsed.ok) return { error: parsed.error, saved: false };

  const shots: Uint8Array[] = [];
  let total = 0;
  for (const file of files) {
    const sniffed = sniffMemoryPhoto(new Uint8Array(await file.arrayBuffer()));
    if (!sniffed.ok || sniffed.value.contentType !== "image/jpeg") {
      return { error: BOOTH_JPEG_ERROR, saved: false };
    }
    if (sniffed.value.bytes.byteLength > MEMORY_MAX_BYTES) {
      return { error: BOOTH_JPEG_ERROR, saved: false };
    }
    total += sniffed.value.bytes.byteLength;
    shots.push(sniffed.value.bytes);
  }
  if (total > BOOTH_TOTAL_MAX_BYTES) {
    return { error: BOOTH_TOTAL_ERROR, saved: false };
  }

  const shared = await enforceSharedLimit({
    key: `memory:${session.userId}`,
    limit: MEMORY_LIMIT,
    window: `${MEMORY_WINDOW_MINUTES} m`,
    error: BOOTH_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, saved: false };

  const saved = await session.supabase.rpc("save_solo_booth", {
    target_circle: parsed.value.circleId,
    target_theme: parsed.value.theme,
    target_layout: parsed.value.layout,
    target_filter: parsed.value.filter,
    target_caption: parsed.value.caption ?? "",
    shot_sizes: shots.map((shot) => shot.byteLength),
  });

  const recorded = savedSchema.safeParse(saved.data);
  if (saved.error || !recorded.success) {
    console.error("Booth save failed.", saved.error?.code);
    return {
      error:
        boothWriteFailure(saved.error?.message, saved.error?.code) ??
        "That strip wasn't saved.",
      saved: false,
    };
  }

  const paths = recorded.data.paths;
  if (
    paths.length !== shots.length ||
    paths.some(
      (path) =>
        !isBoothShotPath(path) || !path.startsWith(`${parsed.value.circleId}/`),
    )
  ) {
    await discardStrip(session, recorded.data.memory_id, paths);
    return { error: "That strip isn't valid.", saved: false };
  }

  for (let index = 0; index < shots.length; index += 1) {
    const bytes = shots[index]!;
    const path = paths[index]!;
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const uploaded = await session.supabase.storage
      .from(MEMORIES_BUCKET)
      .upload(path, new Blob([body], { type: "image/jpeg" }), {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploaded.error) {
      console.error("Booth frame upload failed.", uploaded.error.message);
      await discardStrip(session, recorded.data.memory_id, paths);
      return {
        error: uploaded.error.message.includes("hsummer_storage_quota")
          ? MEMORY_QUOTA_MESSAGE
          : UPLOAD_FAILED,
        saved: false,
      };
    }
  }

  revalidatePath(`/circles/${parsed.value.circleId}`);
  return { error: null, saved: true };
}

async function discardStrip(
  session: Session,
  memoryId: string,
  paths: readonly string[],
): Promise<void> {
  await session.supabase.from("memories").delete().eq("id", memoryId);
  const removable = paths.filter((path) => isBoothShotPath(path));
  if (removable.length > 0) {
    await session.supabase.storage.from(MEMORIES_BUCKET).remove([...removable]);
  }
}
