"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { pushOrigin } from "@/lib/auth/request-origin";
import { isCircleId } from "@/lib/bucket/fields";
import { notifyGroupBooth, notifyPassPartner } from "@/lib/booth/notify";
import { assignPositions } from "@/lib/booth/positions";
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
  TOGETHER_FALLBACK,
  TOGETHER_WAITING,
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
import {
  recipientReasonMessage,
  resolveCircleRecipient,
} from "@/lib/pings/fields";
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

  const files = formData
    .getAll("shot")
    .filter((value): value is File => value instanceof File && value.size > 0);
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
 * Starts a pass with the caller's frames. A couple, and any circle of two,
 * uses the other person. A larger circle sends `participant` ids. A memory
 * is not created yet.
 */
export async function startPassBooth(
  _previous: PassActionState,
  formData: FormData,
): Promise<PassActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const files = shotFiles(formData);
  const picked = participantIds(formData).filter((id) => id !== session.userId);
  const layoutValue = formData.get("layout");
  const layout =
    layoutValue === "4-cut" || layoutValue === "2-cut" ? layoutValue : null;
  const pickedPlan =
    picked.length > 0 && layout
      ? assignPositions(layout, picked.length + 1)
      : null;
  if (picked.length > 0 && !pickedPlan) {
    return {
      error: "A 2-cut fits two people. A 4-cut fits up to four.",
      notice: null,
    };
  }
  const parsed = parsePassStart({
    circleId: formData.get("circleId"),
    theme: formData.get("theme"),
    layout: formData.get("layout"),
    filter: formData.get("filter"),
    caption: formData.get("caption"),
    shotCount: files.length,
    expectedShots: pickedPlan?.[0]?.length,
  });
  if (!parsed.ok) return { error: parsed.error, notice: null };

  const shots = await readShots(files);
  if (!shots.ok) return { error: shots.error, notice: null };

  const membership = await boothMembership(session, parsed.value.circleId);
  if (!membership.ok) return { error: membership.error, notice: null };

  const shared = await enforceSharedLimit({
    key: `booth-pass:${session.userId}`,
    limit: MEMORY_LIMIT,
    window: `${MEMORY_WINDOW_MINUTES} m`,
    error: BOOTH_RATE_LIMIT_MESSAGE,
  });
  if (!shared.ok) return { error: shared.error, notice: null };

  const created =
    picked.length > 0
      ? await session.supabase.rpc("create_pass_booth_picked", {
          target_circle: parsed.value.circleId,
          participant_ids: [session.userId, ...picked],
          target_theme: parsed.value.theme,
          target_layout: parsed.value.layout,
          target_filter: parsed.value.filter,
          target_caption: parsed.value.caption ?? "",
          shot_sizes: shots.shots.map((shot) => shot.byteLength),
        })
      : await (async () => {
          const partner = passPartner(membership, session.userId);
          if (!partner.ok)
            return {
              error: { message: partner.error, code: "app" },
              data: null,
            };
          return session.supabase.rpc("create_pass_booth", {
            target_circle: parsed.value.circleId,
            partner_id: partner.partnerId,
            target_theme: parsed.value.theme,
            target_layout: parsed.value.layout,
            target_filter: parsed.value.filter,
            target_caption: parsed.value.caption ?? "",
            shot_sizes: shots.shots.map((shot) => shot.byteLength),
          });
        })();
  const recorded = createdSchema.safeParse(created.data);
  if (created.error || !recorded.success) {
    if (created.error?.code !== "app") {
      console.error("Pass start failed.", created.error?.code);
    }
    return {
      error:
        created.error?.code === "app"
          ? created.error.message
          : (boothWriteFailure(created.error?.message, created.error?.code) ??
            "That booth wasn't started."),
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

  const origin = pushOrigin(await headers());
  if (picked.length > 0) {
    await notifyGroupBooth({
      userIds: picked,
      origin,
      circleId: parsed.value.circleId,
    });
  } else {
    const partner = passPartner(membership, session.userId);
    if (partner.ok) {
      await notifyPassPartner({
        partnerId: partner.partnerId,
        origin,
        circleId: parsed.value.circleId,
      });
    }
  }
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

const togetherOpenSchema = z.object({
  session_id: z.string().uuid(),
  positions: z.array(z.number().int()),
  expires_at: z.string(),
});

const togetherLobbySchema = z.object({
  status: z.string(),
  capture_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  ready_ids: z.array(z.string()),
  waiting_ids: z.array(z.string()),
});

export type TogetherActionState = {
  error: string | null;
  notice: string | null;
  captureAt: string | null;
  readyIds: string[];
  waitingIds: string[];
};

const emptyTogether: TogetherActionState = {
  error: null,
  notice: null,
  captureAt: null,
  readyIds: [],
  waitingIds: [],
};

/**
 * Opens a Live Together lobby. A couple, and any circle of two, includes
 * both people. A larger circle sends `participant` ids. No photos yet.
 */
export async function openTogetherBooth(
  _previous: TogetherActionState,
  formData: FormData,
): Promise<TogetherActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const circleValue = formData.get("circleId");
  const circleId = typeof circleValue === "string" ? circleValue : "";
  if (!isCircleId(circleId)) {
    return { ...emptyTogether, error: "That circle isn't available." };
  }
  const theme = formData.get("theme");
  const layout = formData.get("layout");
  if (theme !== "kawaii" && theme !== "minimal") {
    return { ...emptyTogether, error: "Pick Kawaii or Minimal." };
  }
  if (layout !== "4-cut" && layout !== "2-cut") {
    return { ...emptyTogether, error: "Pick a 4-cut or a 2-cut strip." };
  }

  const membership = await boothMembership(session, circleId);
  if (!membership.ok) return { ...emptyTogether, error: membership.error };

  const others = membership.memberIds.filter((id) => id !== session.userId);
  const requested = participantIds(formData).filter(
    (id) => id !== session.userId && others.includes(id),
  );
  let chosen: string[];
  if (membership.circleType === "couple" || others.length === 1) {
    if (others.length !== 1) {
      return { ...emptyTogether, error: PASS_PENDING };
    }
    const partnerId = others[0];
    if (!partnerId) return { ...emptyTogether, error: PASS_PENDING };
    chosen = [session.userId, partnerId];
  } else if (requested.length === 0) {
    return { ...emptyTogether, error: PASS_GROUP };
  } else {
    chosen = [session.userId, ...requested];
  }

  if (!assignPositions(layout, chosen.length)) {
    return {
      ...emptyTogether,
      error: "A 2-cut fits two people. A 4-cut fits up to four.",
    };
  }

  const opened = await session.supabase.rpc("open_together_booth", {
    target_circle: circleId,
    participant_ids: chosen,
    target_theme: theme,
    target_layout: layout,
  });
  const recorded = togetherOpenSchema.safeParse(opened.data);
  if (opened.error || !recorded.success) {
    console.error("Together open failed.", opened.error?.code);
    return {
      ...emptyTogether,
      error:
        boothWriteFailure(opened.error?.message, opened.error?.code) ??
        "That live booth wasn't opened.",
    };
  }

  const origin = pushOrigin(await headers());
  const notifyIds = chosen.filter((id) => id !== session.userId);
  if (membership.circleType === "couple" && notifyIds[0]) {
    await notifyPassPartner({
      partnerId: notifyIds[0],
      origin,
      circleId,
      together: true,
    });
  } else if (notifyIds.length > 0) {
    await notifyGroupBooth({
      userIds: notifyIds,
      origin,
      circleId,
      together: true,
    });
  }

  revalidateBooth(circleId);
  return { ...emptyTogether, notice: TOGETHER_WAITING };
}

/** Stores this person's ready tap and, when everyone is ready, the shutter time. */
export async function markTogetherReady(
  _previous: TogetherActionState,
  formData: FormData,
): Promise<TogetherActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const parsed = parsePassCancel({
    sessionId: formData.get("sessionId"),
    circleId: formData.get("circleId"),
  });
  if (!parsed.ok) return { ...emptyTogether, error: parsed.error };

  const offset = numberField(formData.get("offsetMs"));
  const rtt = numberField(formData.get("rttMs"));
  const marked = await session.supabase.rpc("mark_together_ready", {
    target_session: parsed.value.sessionId,
    offset_ms: offset,
    rtt_ms: rtt,
  });
  const lobby = togetherLobbySchema.safeParse(marked.data);
  if (marked.error || !lobby.success) {
    console.error("Together ready failed.", marked.error?.code);
    return {
      ...emptyTogether,
      error:
        boothWriteFailure(marked.error?.message, marked.error?.code) ??
        "That ready tap wasn't saved.",
    };
  }

  revalidateBooth(parsed.value.circleId);
  return {
    error: null,
    notice: lobby.data.capture_at
      ? "Everyone is ready. Hold still."
      : "You're ready. Waiting on the others.",
    captureAt: lobby.data.capture_at,
    readyIds: lobby.data.ready_ids,
    waitingIds: lobby.data.waiting_ids,
  };
}

/** Adds this person's frames after the shared shutter. */
export async function submitTogetherShots(
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

  const submitted = await session.supabase.rpc("submit_together_shots", {
    target_session: parsed.value.sessionId,
    target_filter: parsed.value.filter,
    shot_sizes: shots.shots.map((shot) => shot.byteLength),
  });
  const recorded = submittedSchema.safeParse(submitted.data);
  if (submitted.error || !recorded.success) {
    console.error("Together frames failed.", submitted.error?.code);
    return {
      error:
        boothWriteFailure(submitted.error?.message, submitted.error?.code) ??
        "Those frames weren't saved.",
      notice: null,
    };
  }
  if (recorded.data.status === "expired") {
    return { error: PASS_EXPIRED, notice: null };
  }
  if (recorded.data.status === "cancelled") {
    return { error: PASS_CANCELLED, notice: null };
  }

  const paths = recorded.data.paths;
  if (
    paths.length > 0 &&
    (!pathsBelong(paths, shots.shots.length, circleId) ||
      paths.some((path) => !path.includes(`/${parsed.value.sessionId}/`)))
  ) {
    if (!recorded.data.already) {
      await session.supabase.rpc("release_together_shots", {
        target_session: parsed.value.sessionId,
      });
    }
    return { error: "That booth isn't valid.", notice: null };
  }

  if (paths.length > 0) {
    const uploaded = await putFrames(
      session,
      shots.shots,
      paths,
      recorded.data.already,
    );
    if (!uploaded.ok) {
      if (!recorded.data.already) {
        await session.supabase.rpc("release_together_shots", {
          target_session: parsed.value.sessionId,
        });
        await removeFrames(session, paths);
      }
      return { error: uploaded.error, notice: null };
    }
  }

  const finished = await session.supabase.rpc("finish_together_booth", {
    target_session: parsed.value.sessionId,
  });
  const done = finishedSchema.safeParse(finished.data);
  if (finished.error || !done.success) {
    console.error("Together finish failed.", finished.error?.code);
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
  return {
    error: null,
    notice: "Your frames are in. The strip is still waiting on the others.",
  };
}

export async function cancelTogetherBooth(
  _previous: TogetherActionState,
  formData: FormData,
): Promise<TogetherActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");
  const parsed = parsePassCancel({
    sessionId: formData.get("sessionId"),
    circleId: formData.get("circleId"),
  });
  if (!parsed.ok) return { ...emptyTogether, error: parsed.error };

  const cancelled = await session.supabase.rpc("cancel_together_booth", {
    target_session: parsed.value.sessionId,
  });
  if (cancelled.error) {
    return {
      ...emptyTogether,
      error:
        boothWriteFailure(cancelled.error.message, cancelled.error.code) ??
        "That booth wasn't cancelled.",
    };
  }
  revalidateBooth(parsed.value.circleId);
  return {
    ...emptyTogether,
    notice: "Cancelled. The unfinished frames were removed.",
  };
}

/** Turns an open lobby into a pass before the shutter is set. */
export async function fallbackTogetherToPass(
  _previous: TogetherActionState,
  formData: FormData,
): Promise<TogetherActionState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");
  const parsed = parsePassCancel({
    sessionId: formData.get("sessionId"),
    circleId: formData.get("circleId"),
  });
  if (!parsed.ok) return { ...emptyTogether, error: parsed.error };

  const fell = await session.supabase.rpc("fallback_together_to_pass", {
    target_session: parsed.value.sessionId,
  });
  if (fell.error) {
    return {
      ...emptyTogether,
      error:
        boothWriteFailure(fell.error.message, fell.error.code) ??
        "That booth couldn't switch to a pass.",
    };
  }
  revalidateBooth(parsed.value.circleId);
  return { ...emptyTogether, notice: TOGETHER_FALLBACK };
}

function numberField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
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

type BoothMembership = {
  ok: true;
  circleType: string;
  status: string;
  memberIds: string[];
};

async function boothMembership(
  session: Session,
  circleId: string,
): Promise<BoothMembership | { ok: false; error: string }> {
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

  return {
    ok: true,
    circleType: circle.data.circle_type,
    status: circle.data.status,
    memberIds: members.data.map((row) => row.user_id),
  };
}

function passPartner(
  membership: BoothMembership,
  selfId: string,
): { ok: true; partnerId: string } | { ok: false; error: string } {
  const resolved = resolveCircleRecipient({
    selfId,
    circleType: membership.circleType,
    status: membership.status,
    activeMemberIds: membership.memberIds,
    request: { kind: "auto" },
    allowBroadcast: false,
  });
  if (!resolved.ok) {
    if (resolved.reason === "pending" || resolved.reason === "no_partner") {
      return { ok: false, error: PASS_PENDING };
    }
    if (resolved.reason === "needs_choice" || resolved.reason === "ambiguous") {
      return { ok: false, error: PASS_GROUP };
    }
    return {
      ok: false,
      error: recipientReasonMessage(resolved.reason, "ping").error,
    };
  }
  if (!resolved.toUserId) return { ok: false, error: PASS_GROUP };
  return { ok: true, partnerId: resolved.toUserId };
}

function participantIds(formData: FormData): string[] {
  const ids = formData
    .getAll("participant")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => isCircleId(value));
  return [...new Set(ids)];
}

const PASS_UNAVAILABLE_RETRY =
  "The circle couldn't be read. Reload the page and try again.";
