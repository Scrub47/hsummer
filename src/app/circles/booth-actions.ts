"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { pushOrigin } from "@/lib/auth/request-origin";
import { isCircleId } from "@/lib/bucket/fields";
import { notifyPassPartner } from "@/lib/booth/notify";
import {
  BOOTH_JPEG_ERROR,
  BOOTH_RATE_LIMIT_MESSAGE,
  BOOTH_TOTAL_ERROR,
  BOOTH_TOTAL_MAX_BYTES,
  MEMORY_MAX_BYTES,
  PASS_CANCELLED,
  PASS_EXPIRED,
  PASS_FINISHED,
  PASS_GROUP,
  PASS_PENDING,
  PASS_WAITING,
  boothWriteFailure,
  isBoothShotPath,
  parseBoothForm,
  parsePassCancel,
  parsePassStart,
  parsePassTurn,
} from "@/lib/booth/fields";
import {
  MEMORY_LIMIT,
  MEMORY_QUOTA_MESSAGE,
  MEMORY_WINDOW_MINUTES,
  MEMORIES_BUCKET,
} from "@/lib/memories/fields";
import { sniffMemoryPhoto } from "@/lib/memories/photo";
import { partnerReasonMessage, resolveCouplePartner } from "@/lib/pings/fields";
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

export type PassActionState = {
  error: string | null;
  notice: string | null;
};

const createdSchema = z.object({
  session_id: z.string().uuid(),
  positions: z.array(z.number().int()),
  paths: z.array(z.string()),
});

const submittedSchema = z.object({
  status: z.string(),
  paths: z.array(z.string()),
  already: z.boolean(),
});

const finishedSchema = z.object({
  status: z.string(),
  memory_id: z.string().uuid().nullable(),
});

/**
 * Starts a pass with the caller's frames and tells their partner. The
 * partner is the other person in the couple. The form cannot pick someone
 * else. A memory is not created yet.
 */
export async function startPassBooth(
  _previous: PassActionState,
  formData: FormData,
): Promise<PassActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const files = shotFiles(formData);
  const parsed = parsePassStart({
    circleId: formData.get("circleId"),
    theme: formData.get("theme"),
    layout: formData.get("layout"),
    filter: formData.get("filter"),
    caption: formData.get("caption"),
    shotCount: files.length,
  });
  if (!parsed.ok) return { error: parsed.error, notice: null };

  const shots = await readShots(files);
  if (!shots.ok) return { error: shots.error, notice: null };

  const partner = await passPartner(session, parsed.value.circleId);
  if (!partner.ok) return { error: partner.error, notice: null };

  const shared = await enforceSharedLimit({
    key: `booth-pass:${session.userId}`,
    limit: MEMORY_LIMIT,
    window: `${MEMORY_WINDOW_MINUTES} m`,
    error: BOOTH_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, notice: null };

  const created = await session.supabase.rpc("create_pass_booth", {
    target_circle: parsed.value.circleId,
    partner_id: partner.partnerId,
    target_theme: parsed.value.theme,
    target_layout: parsed.value.layout,
    target_filter: parsed.value.filter,
    target_caption: parsed.value.caption ?? "",
    shot_sizes: shots.shots.map((shot) => shot.byteLength),
  });
  const recorded = createdSchema.safeParse(created.data);
  if (created.error || !recorded.success) {
    console.error("Pass start failed.", created.error?.code);
    return {
      error:
        boothWriteFailure(created.error?.message, created.error?.code) ??
        "That booth wasn't started.",
      notice: null,
    };
  }

  const paths = recorded.data.paths;
  if (!pathsBelong(paths, shots.shots.length, parsed.value.circleId)) {
    await session.supabase.rpc("discard_pass_booth", {
      target_session: recorded.data.session_id,
    });
    return { error: "That booth isn't valid.", notice: null };
  }

  const uploaded = await putFrames(session, shots.shots, paths, false);
  if (!uploaded.ok) {
    await session.supabase.rpc("discard_pass_booth", {
      target_session: recorded.data.session_id,
    });
    await removeFrames(session, paths);
    return { error: uploaded.error, notice: null };
  }

  await notifyPassPartner({
    partnerId: partner.partnerId,
    origin: pushOrigin(await headers()),
    circleId: parsed.value.circleId,
  });
  revalidateBooth(parsed.value.circleId);
  return { error: null, notice: PASS_WAITING };
}

/**
 * Adds the caller's frames to an open pass. When that fills the strip, the
 * memory is created and both of you can see it on the wall.
 */
export async function submitPassTurn(
  _previous: PassActionState,
  formData: FormData,
): Promise<PassActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const files = shotFiles(formData);
  const parsed = parsePassTurn({
    sessionId: formData.get("sessionId"),
    filter: formData.get("filter"),
    shotCount: files.length,
  });
  if (!parsed.ok) return { error: parsed.error, notice: null };
  const circleValue = formData.get("circleId");
  const circleId = typeof circleValue === "string" ? circleValue : "";
  if (!isCircleId(circleId)) {
    return { error: "That circle isn't available.", notice: null };
  }

  const shots = await readShots(files);
  if (!shots.ok) return { error: shots.error, notice: null };

  const shared = await enforceSharedLimit({
    key: `memory:${session.userId}`,
    limit: MEMORY_LIMIT,
    window: `${MEMORY_WINDOW_MINUTES} m`,
    error: BOOTH_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, notice: null };

  const submitted = await session.supabase.rpc("submit_pass_shots", {
    target_session: parsed.value.sessionId,
    target_filter: parsed.value.filter,
    shot_sizes: shots.shots.map((shot) => shot.byteLength),
  });
  const recorded = submittedSchema.safeParse(submitted.data);
  if (submitted.error || !recorded.success) {
    console.error("Pass frames failed.", submitted.error?.code);
    return {
      error:
        boothWriteFailure(submitted.error?.message, submitted.error?.code) ??
        "Those frames weren't saved.",
      notice: null,
    };
  }

  if (recorded.data.status === "expired") {
    revalidateBooth(circleId);
    return { error: PASS_EXPIRED, notice: null };
  }
  if (recorded.data.status === "cancelled") {
    revalidateBooth(circleId);
    return { error: PASS_CANCELLED, notice: null };
  }
  if (recorded.data.status !== "open") {
    return { error: "That booth isn't open.", notice: null };
  }

  const paths = recorded.data.paths;
  if (
    !pathsBelong(paths, shots.shots.length, circleId) ||
    paths.some((path) => !path.includes(`/${parsed.value.sessionId}/`))
  ) {
    if (!recorded.data.already) {
      await session.supabase.rpc("release_pass_shots", {
        target_session: parsed.value.sessionId,
      });
    }
    return { error: "That booth isn't valid.", notice: null };
  }

  const uploaded = await putFrames(
    session,
    shots.shots,
    paths,
    recorded.data.already,
  );
  if (!uploaded.ok) {
    if (!recorded.data.already) {
      await session.supabase.rpc("release_pass_shots", {
        target_session: parsed.value.sessionId,
      });
      await removeFrames(session, paths);
    }
    return { error: uploaded.error, notice: null };
  }

  const finished = await session.supabase.rpc("finish_pass_booth", {
    target_session: parsed.value.sessionId,
  });
  const done = finishedSchema.safeParse(finished.data);
  if (finished.error || !done.success) {
    console.error("Pass finish failed.", finished.error?.code);
    return {
      error:
        boothWriteFailure(finished.error?.message, finished.error?.code) ??
        "The strip wasn't finished. Try again.",
      notice: null,
    };
  }

  revalidateBooth(circleId);
  if (done.data.status === "complete") {
    return { error: null, notice: PASS_FINISHED };
  }
  if (done.data.status === "expired")
    return { error: PASS_EXPIRED, notice: null };
  if (done.data.status === "cancelled") {
    return { error: PASS_CANCELLED, notice: null };
  }
  return {
    error: null,
    notice: "Your frames are in. The strip is still waiting.",
  };
}

/** The person who started an open pass can close it. */
export async function cancelPassBooth(
  _previous: PassActionState,
  formData: FormData,
): Promise<PassActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const parsed = parsePassCancel({
    sessionId: formData.get("sessionId"),
    circleId: formData.get("circleId"),
  });
  if (!parsed.ok) return { error: parsed.error, notice: null };

  const cancelled = await session.supabase.rpc("cancel_pass_booth", {
    target_session: parsed.value.sessionId,
  });
  if (cancelled.error) {
    console.error("Pass cancel failed.", cancelled.error.code);
    return {
      error:
        boothWriteFailure(cancelled.error.message, cancelled.error.code) ??
        "That booth wasn't cancelled.",
      notice: null,
    };
  }

  revalidateBooth(parsed.value.circleId);
  return {
    error: null,
    notice: "Cancelled. The unfinished frames were removed.",
  };
}

function shotFiles(formData: FormData): File[] {
  return formData
    .getAll("shot")
    .filter((value): value is File => value instanceof File && value.size > 0);
}

async function readShots(
  files: File[],
): Promise<{ ok: true; shots: Uint8Array[] } | { ok: false; error: string }> {
  const shots: Uint8Array[] = [];
  let total = 0;
  for (const file of files) {
    const sniffed = sniffMemoryPhoto(new Uint8Array(await file.arrayBuffer()));
    if (!sniffed.ok || sniffed.value.contentType !== "image/jpeg") {
      return { ok: false, error: BOOTH_JPEG_ERROR };
    }
    if (sniffed.value.bytes.byteLength > MEMORY_MAX_BYTES) {
      return { ok: false, error: BOOTH_JPEG_ERROR };
    }
    total += sniffed.value.bytes.byteLength;
    shots.push(sniffed.value.bytes);
  }
  if (total > BOOTH_TOTAL_MAX_BYTES) {
    return { ok: false, error: BOOTH_TOTAL_ERROR };
  }
  return { ok: true, shots };
}

function pathsBelong(
  paths: readonly string[],
  count: number,
  circleId: string,
): boolean {
  return (
    paths.length === count &&
    paths.every(
      (path) => isBoothShotPath(path) && path.startsWith(`${circleId}/`),
    )
  );
}

async function putFrames(
  session: Session,
  shots: Uint8Array[],
  paths: readonly string[],
  allowExisting: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
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
      if (allowExisting && isAlreadyStored(uploaded.error.message)) continue;
      console.error("Booth frame upload failed.", uploaded.error.message);
      return {
        ok: false,
        error: uploaded.error.message.includes("hsummer_storage_quota")
          ? MEMORY_QUOTA_MESSAGE
          : UPLOAD_FAILED,
      };
    }
  }
  return { ok: true };
}

function isAlreadyStored(message: string): boolean {
  return /already exists|duplicate/i.test(message);
}

async function removeFrames(
  session: Session,
  paths: readonly string[],
): Promise<void> {
  const removable = paths.filter((path) => isBoothShotPath(path));
  if (removable.length > 0) {
    await session.supabase.storage.from(MEMORIES_BUCKET).remove([...removable]);
  }
}

function revalidateBooth(circleId: string): void {
  revalidatePath(`/circles/${circleId}`);
  revalidatePath(`/circles/${circleId}/booth`);
  revalidatePath("/home");
}

async function passPartner(
  session: Session,
  circleId: string,
): Promise<{ ok: true; partnerId: string } | { ok: false; error: string }> {
  const circle = await session.supabase
    .from("circles")
    .select("circle_type, status")
    .eq("id", circleId)
    .maybeSingle();

  if (circle.error) return { ok: false, error: PASS_UNAVAILABLE_RETRY };
  if (!circle.data) return { ok: false, error: "That circle isn't available." };

  const members = await session.supabase
    .from("circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .is("left_at", null);

  if (members.error || !members.data) {
    return { ok: false, error: PASS_UNAVAILABLE_RETRY };
  }

  const resolved = resolveCouplePartner({
    selfId: session.userId,
    circleType: circle.data.circle_type,
    status: circle.data.status,
    activeMemberIds: members.data.map((row) => row.user_id),
  });
  if (!resolved.ok) {
    if (resolved.reason === "pending" || resolved.reason === "no_partner") {
      return { ok: false, error: PASS_PENDING };
    }
    if (resolved.reason === "not_couple" || resolved.reason === "ambiguous") {
      return { ok: false, error: PASS_GROUP };
    }
    return { ok: false, error: partnerReasonMessage(resolved.reason).error };
  }
  return { ok: true, partnerId: resolved.partnerId };
}

const PASS_UNAVAILABLE_RETRY =
  "The circle couldn't be read. Reload the page and try again.";
