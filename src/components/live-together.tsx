"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  cancelTogetherBooth,
  fallbackTogetherToPass,
  markTogetherReady,
  openTogetherBooth,
  submitTogetherShots,
  type PassActionState,
  type TogetherActionState,
} from "@/app/circles/booth-actions";
import {
  cameraAttempts,
  cameraErrorCopy,
  CAMERA_FAILED,
  type CameraFacing,
} from "@/lib/booth/camera";
import {
  bestClockEstimate,
  shouldCapture,
  togetherTopic,
  type ClockEstimate,
  type ClockSample,
} from "@/lib/booth/clock";
import {
  BOOTH_FILTERS,
  BOOTH_LAYOUTS,
  BOOTH_THEMES,
  PASS_PENDING,
  SHOT_JPEG_QUALITY,
  filterLabel,
  layoutLabel,
  type BoothFilter,
  type BoothLayout,
  type BoothTheme,
  type TogetherLobby,
} from "@/lib/booth/fields";
import { applyFilter } from "@/lib/booth/filters";
import { coverCrop, frameSlots, type Slot } from "@/lib/booth/layout";
import { assignPositions } from "@/lib/booth/positions";
import { themeBundle } from "@/lib/booth/themes";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

const openInitial: TogetherActionState = {
  error: null,
  notice: null,
  captureAt: null,
  readyIds: [],
  waitingIds: [],
};

const passInitial: PassActionState = { error: null, notice: null };

type Person = { userId: string; displayName: string };

/**
 * Live Together. Everyone taps ready, then the shutter fires at one
 * server time. If the private channel fails, the person who opened the
 * lobby can turn it into a pass.
 */
export function LiveTogether({
  circleId,
  canStart,
  blocked,
  people,
  needsPicker,
  selfId,
  lobby,
}: {
  circleId: string;
  canStart: boolean;
  blocked: "pending" | "alone" | null;
  people: Person[];
  needsPicker: boolean;
  selfId: string;
  lobby: TogetherLobby | null;
}) {
  if (lobby) {
    return <Lobby circleId={circleId} selfId={selfId} lobby={lobby} />;
  }
  if (!canStart) {
    return (
      <p className="text-sm leading-6 text-foreground/80">
        {blocked === "pending"
          ? PASS_PENDING
          : "Live Together needs at least two people in this circle."}
      </p>
    );
  }
  return (
    <OpenLobby circleId={circleId} people={people} needsPicker={needsPicker} />
  );
}

function OpenLobby({
  circleId,
  people,
  needsPicker,
}: {
  circleId: string;
  people: Person[];
  needsPicker: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    openTogetherBooth,
    openInitial,
  );
  const [theme, setTheme] = useState<BoothTheme>("kawaii");
  const [layout, setLayout] = useState<BoothLayout>("4-cut");
  const [selected, setSelected] = useState<string[]>(() =>
    people.slice(0, layout === "4-cut" ? 3 : 1).map((person) => person.userId),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="theme" value={theme} />
      <input type="hidden" name="layout" value={layout} />
      <p className="max-w-xl text-base leading-7 text-foreground/80">
        {needsPicker
          ? "Pick who is in this strip. Everyone taps ready, then the photos are taken at the same moment."
          : "Both of you tap ready, then the photos are taken at the same moment."}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
        {BOOTH_THEMES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
            className={chip(theme === value)}
          >
            {themeBundle(value).label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Layout">
        {BOOTH_LAYOUTS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={layout === value}
            onClick={() => {
              setLayout(value);
              setSelected((current) =>
                current.slice(0, value === "4-cut" ? 3 : 1),
              );
            }}
            className={chip(layout === value)}
          >
            {layoutLabel(value)}
          </button>
        ))}
      </div>
      {needsPicker ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Who is in this booth</legend>
          {people.map((person) => (
            <label
              key={person.userId}
              className="flex items-center gap-3 text-sm"
            >
              <input
                type="checkbox"
                name="participant"
                value={person.userId}
                checked={selected.includes(person.userId)}
                onChange={() => {
                  setSelected((current) => {
                    if (current.includes(person.userId)) {
                      return current.filter((id) => id !== person.userId);
                    }
                    const max = layout === "4-cut" ? 3 : 1;
                    if (current.length >= max) return current;
                    return [...current, person.userId];
                  });
                }}
              />
              {person.displayName}
            </label>
          ))}
        </fieldset>
      ) : null}
      {needsPicker && !assignPositions(layout, selected.length + 1) ? (
        <p className="text-sm">Choose who is in this booth.</p>
      ) : null}
      {state.error ? (
        <p className="text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-pine" role="status">
          {state.notice}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || (needsPicker && selected.length === 0)}
        className="h-12 w-fit rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open a live booth"}
      </button>
    </form>
  );
}

function Lobby({
  circleId,
  selfId,
  lobby,
}: {
  circleId: string;
  selfId: string;
  lobby: TogetherLobby;
}) {
  const [readyState, readyAction, readyPending] = useActionState(
    markTogetherReady,
    openInitial,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelTogetherBooth,
    openInitial,
  );
  const [fallbackState, fallbackAction, fallbackPending] = useActionState(
    fallbackTogetherToPass,
    openInitial,
  );
  const [shotState, shotAction, shotPending] = useActionState(
    submitTogetherShots,
    passInitial,
  );
  const [channel, setChannel] = useState<"connecting" | "live" | "off">(() =>
    getSupabaseBrowserConfig() ? "connecting" : "off",
  );
  const [here, setHere] = useState<string[]>([]);
  const [remoteCapture, setRemoteCapture] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoothFilter>("none");
  const [shots, setShots] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [countLabel, setCountLabel] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clockRef = useRef<ClockEstimate | null>(null);
  const channelRef = useRef<ReturnType<
    NonNullable<ReturnType<typeof createClient>>["channel"]
  > | null>(null);
  const shooting = useRef(false);

  const captureAt =
    readyState.captureAt ?? remoteCapture ?? lobby.captureAt ?? null;
  const readyIds =
    readyState.readyIds.length > 0 ? readyState.readyIds : lobby.readyIds;
  const waitingIds =
    readyState.waitingIds.length > 0 ? readyState.waitingIds : lobby.waitingIds;
  const iAmReady = readyIds.includes(selfId);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    const topic = togetherTopic(lobby.sessionId);
    void supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!active) return;
      if (!token) {
        setChannel("off");
        return;
      }
      await supabase.realtime.setAuth(token);
      if (!active) return;
      const room = supabase.channel(topic, { config: { private: true } });
      channelRef.current = room;
      room
        .on("broadcast", { event: "lobby" }, ({ payload }) => {
          const next = payload as { captureAt?: string | null };
          if (typeof next.captureAt === "string")
            setRemoteCapture(next.captureAt);
        })
        .on("presence", { event: "sync" }, () => {
          const state = room.presenceState() as Record<
            string,
            { userId?: string }[]
          >;
          const ids = Object.values(state)
            .flat()
            .map((entry) => entry.userId)
            .filter((id): id is string => typeof id === "string");
          setHere([...new Set(ids)]);
        })
        .subscribe((status) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            setChannel("live");
            void room.track({ userId: selfId });
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            setChannel("off");
          }
        });
    });
    return () => {
      active = false;
      const room = channelRef.current;
      channelRef.current = null;
      if (room) void supabase.removeChannel(room);
      stopStream(streamRef.current);
    };
  }, [lobby.sessionId, selfId]);

  useEffect(() => {
    if (!readyState.captureAt && readyState.readyIds.length === 0) return;
    void channelRef.current?.send({
      type: "broadcast",
      event: "lobby",
      payload: {
        captureAt: readyState.captureAt,
        readyIds: readyState.readyIds,
        waitingIds: readyState.waitingIds,
      },
    });
  }, [readyState.captureAt, readyState.readyIds, readyState.waitingIds]);

  useEffect(() => {
    if (!captureAt || shots.length > 0 || shooting.current) return;
    let cancelled = false;
    void (async () => {
      const estimate = clockRef.current ?? (await sampleClock());
      clockRef.current = estimate;
      const captureMs = Date.parse(captureAt);
      if (!Number.isFinite(captureMs)) return;
      while (
        !cancelled &&
        !shouldCapture({
          clientNow: Date.now(),
          offsetMs: estimate?.offsetMs ?? 0,
          captureAtMs: captureMs,
        })
      ) {
        await wait(80);
      }
      if (cancelled || shooting.current) return;
      await shoot(lobby.myPositions.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [captureAt, lobby.myPositions.length, shots.length]);

  async function arm() {
    setError(null);
    await startCamera();
    const estimate = await sampleClock();
    clockRef.current = estimate;
    const data = new FormData();
    data.set("circleId", circleId);
    data.set("sessionId", lobby.sessionId);
    if (estimate) {
      data.set("offsetMs", String(estimate.offsetMs));
      data.set("rttMs", String(estimate.rttMs));
    }
    readyAction(data);
  }

  async function startCamera(facing: CameraFacing = "user") {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError(cameraErrorCopy(new DOMException("insecure", "SecurityError")));
      return;
    }
    let lastError: unknown = new Error("camera");
    for (const constraints of cameraAttempts(facing)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => setError(CAMERA_FAILED));
        }
        return;
      } catch (caught) {
        lastError = caught;
        const name = caught instanceof DOMException ? caught.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError")
          break;
      }
    }
    setError(cameraErrorCopy(lastError));
  }

  async function shoot(needed: number) {
    if (shooting.current) return;
    const video = videoRef.current;
    const slot = frameSlots(lobby.layout, themeBundle(lobby.theme))[0];
    if (!video || !slot || video.videoWidth === 0) {
      await startCamera();
    }
    const live = videoRef.current;
    if (!live || !slot || live.videoWidth === 0) {
      setError(
        "The camera isn't ready. Tap ready again, or pass the booth instead.",
      );
      return;
    }
    shooting.current = true;
    const taken: Blob[] = [];
    try {
      for (let index = 0; index < needed; index += 1) {
        setCountLabel("Smile");
        const jpeg = await frameToJpeg(
          live,
          live.videoWidth,
          live.videoHeight,
          slot,
          filter,
        );
        taken.push(jpeg);
        if (index < needed - 1) await wait(600);
      }
      setShots(taken);
      setCountLabel(null);
    } catch {
      setError("Those photos couldn't be taken. Pass the booth instead.");
    } finally {
      shooting.current = false;
    }
  }

  const names = new Map(
    lobby.people.map((person) => [person.userId, person.displayName]),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-base leading-7 text-foreground/80">
        Tap ready when your camera is on. The photos are taken together once
        everyone is ready. This lobby closes
        {lobby.expiresAt
          ? ` at ${formatWhen(lobby.expiresAt)}`
          : " after 10 minutes"}
        .
      </p>
      <p className="text-sm text-foreground/70" role="status">
        {channel === "live"
          ? "Live. You'll see who is here."
          : channel === "connecting"
            ? "Connecting the live booth…"
            : "The live channel isn't connected. You can still tap ready. If it stays stuck, pass the booth instead."}
      </p>
      <ul className="flex flex-col gap-2">
        {lobby.people.map((person) => {
          const ready = readyIds.includes(person.userId);
          const present = here.includes(person.userId);
          return (
            <li key={person.userId} className="text-sm">
              {names.get(person.userId) ?? person.displayName}
              {person.userId === selfId ? " (you)" : ""}
              {" — "}
              {ready ? "ready" : present ? "here, not ready" : "not here yet"}
            </li>
          );
        })}
      </ul>
      {waitingIds.length > 0 && !captureAt ? (
        <p className="text-sm text-foreground/70">
          Still waiting on{" "}
          {waitingIds.map((id) => names.get(id) ?? "someone").join(", ")}.
        </p>
      ) : null}
      <div className="relative overflow-hidden rounded-3xl bg-black">
        <video
          ref={videoRef}
          className="aspect-[3/4] w-full -scale-x-100 object-cover"
          autoPlay
          muted
          playsInline
          aria-label="Camera preview, mirrored"
        />
        {countLabel ? (
          <p className="absolute inset-0 grid place-items-center font-serif text-7xl text-white">
            {countLabel}
          </p>
        ) : null}
      </div>
      {captureAt && shots.length === 0 ? (
        <button
          type="button"
          onClick={() => void shoot(lobby.myPositions.length)}
          className="h-12 w-fit rounded-full bg-accent px-5 text-base font-medium text-accent-ink"
        >
          Take the photos
        </button>
      ) : null}
      {!iAmReady && !captureAt ? (
        <div className="flex flex-col gap-3">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Your filter"
          >
            {BOOTH_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={chip(filter === value)}
              >
                {filterLabel(value)}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={readyPending}
            onClick={() => void arm()}
            className="h-12 w-fit rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
          >
            {readyPending ? "Getting ready…" : "I'm ready"}
          </button>
        </div>
      ) : null}
      {shots.length > 0 ? (
        <form
          className="flex flex-col gap-3"
          action={(formData) => {
            shots.forEach((blob, index) => {
              formData.append(
                "shot",
                new File([blob], `shot-${index}.jpg`, { type: "image/jpeg" }),
              );
            });
            shotAction(formData);
          }}
        >
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="sessionId" value={lobby.sessionId} />
          <input type="hidden" name="filter" value={filter} />
          <button
            type="submit"
            disabled={shotPending}
            className="h-12 w-fit rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
          >
            {shotPending ? "Saving…" : "Save your frames"}
          </button>
        </form>
      ) : null}
      {readyState.error ? (
        <p className="text-sm" role="alert">
          {readyState.error}
        </p>
      ) : null}
      {readyState.notice ? (
        <p className="text-sm text-pine" role="status">
          {readyState.notice}
        </p>
      ) : null}
      {shotState.error ? (
        <p className="text-sm" role="alert">
          {shotState.error}
        </p>
      ) : null}
      {shotState.notice ? (
        <p className="text-sm text-pine" role="status">
          {shotState.notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {lobby.startedByMe && !captureAt ? (
        <div className="flex flex-wrap gap-3">
          <form action={cancelAction}>
            <input type="hidden" name="circleId" value={circleId} />
            <input type="hidden" name="sessionId" value={lobby.sessionId} />
            <button
              type="submit"
              disabled={cancelPending}
              className="h-12 rounded-full border border-line bg-background px-5 text-base font-medium disabled:opacity-60"
            >
              {cancelPending ? "Cancelling…" : "Cancel this booth"}
            </button>
          </form>
          {channel === "off" ? (
            <form action={fallbackAction}>
              <input type="hidden" name="circleId" value={circleId} />
              <input type="hidden" name="sessionId" value={lobby.sessionId} />
              <button
                type="submit"
                disabled={fallbackPending}
                className="h-12 rounded-full border border-line bg-card px-5 text-base font-medium disabled:opacity-60"
              >
                {fallbackPending ? "Switching…" : "Pass the booth instead"}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      {cancelState.error || fallbackState.error ? (
        <p className="text-sm" role="alert">
          {cancelState.error ?? fallbackState.error}
        </p>
      ) : null}
      {cancelState.notice || fallbackState.notice ? (
        <p className="text-sm text-pine" role="status">
          {cancelState.notice ?? fallbackState.notice}
        </p>
      ) : null}
      {!lobby.startedByMe && channel === "off" && !captureAt ? (
        <p className="text-sm text-foreground/70">
          If this stays stuck, the person who started it can switch to Pass the
          booth.
        </p>
      ) : null}
    </div>
  );
}

function chip(pressed: boolean): string {
  return `h-10 rounded-full border px-4 text-sm font-medium ${
    pressed
      ? "border-pine bg-pine text-white"
      : "border-line bg-card text-foreground"
  }`;
}

async function sampleClock(): Promise<ClockEstimate | null> {
  const samples: ClockSample[] = [];
  for (let index = 0; index < 3; index += 1) {
    const t0 = Date.now();
    try {
      const response = await fetch("/api/time", { cache: "no-store" });
      const t1 = Date.now();
      const body = (await response.json()) as { serverNow?: number };
      if (typeof body.serverNow === "number") {
        samples.push({ t0, t1, serverNow: body.serverNow });
      }
    } catch {
      // A failed sample is skipped. The smallest successful round trip wins.
    }
  }
  return bestClockEstimate(samples);
}

async function frameToJpeg(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  slot: Slot,
  filter: BoothFilter,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = slot.width;
  canvas.height = slot.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  const crop = coverCrop(sourceWidth, sourceHeight, slot.width, slot.height);
  context.drawImage(
    source,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    slot.width,
    slot.height,
  );
  if (filter !== "none") {
    const pixels = context.getImageData(0, 0, slot.width, slot.height);
    applyFilter(pixels.data, filter);
    context.putImageData(pixels, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", SHOT_JPEG_QUALITY);
  });
  if (!blob) throw new Error("jpeg");
  return blob;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
