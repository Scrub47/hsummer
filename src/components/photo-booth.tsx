"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

import {
  saveSoloBooth,
  type BoothActionState,
} from "@/app/circles/booth-actions";
import { PhotoStrip } from "@/components/photo-strip";
import {
  cameraAttempts,
  cameraErrorCopy,
  CAMERA_FAILED,
  type CameraFacing,
} from "@/lib/booth/camera";
import {
  BOOTH_FILTERS,
  BOOTH_LAYOUTS,
  BOOTH_THEMES,
  SHOT_JPEG_QUALITY,
  filterLabel,
  layoutLabel,
  shotCount,
  type BoothFilter,
  type BoothLayout,
  type BoothTheme,
} from "@/lib/booth/fields";
import { MEMORY_CAPTION_MAX } from "@/lib/memories/fields";
import { applyFilter } from "@/lib/booth/filters";
import { coverCrop, frameSlots, type Slot } from "@/lib/booth/layout";
import { themeBundle } from "@/lib/booth/themes";

const initialState: BoothActionState = { error: null, saved: false };

/**
 * Solo Booth. The camera stays on this phone. Nothing is written until Save
 * to this circle, which adds one photo-strip memory. Download never touches
 * the database.
 */
export function PhotoBooth({
  circleId,
  circleTitle,
}: {
  circleId: string;
  circleTitle: string;
}) {
  const [theme, setTheme] = useState<BoothTheme>("kawaii");
  const [layout, setLayout] = useState<BoothLayout>("4-cut");
  const [filter, setFilter] = useState<BoothFilter>("none");
  const [phase, setPhase] = useState<"setup" | "live" | "review">("setup");
  const [facing, setFacing] = useState<CameraFacing>("user");
  const [error, setError] = useState<string | null>(null);
  const [countLabel, setCountLabel] = useState<string | null>(null);
  const [shots, setShots] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [stripBlob, setStripBlob] = useState<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const [streamVersion, setStreamVersion] = useState(0);

  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || phase !== "live") return;
    video.srcObject = stream;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "true");
    void video.play().catch(() => {
      setError(CAMERA_FAILED);
    });
  }, [phase, streamVersion]);

  const needed = shotCount(layout);
  const slot = frameSlots(layout, themeBundle(theme))[0];
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  function resetShots() {
    cancelRef.current = true;
    stopStream(streamRef.current);
    streamRef.current = null;
    setShots([]);
    setStripBlob(null);
    setCountLabel(null);
    setPhase("setup");
    setBusy(false);
  }

  async function startCamera(nextFacing = facing) {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(cameraErrorCopy(new DOMException("missing", "SecurityError")));
      return;
    }
    if (!window.isSecureContext) {
      setError(cameraErrorCopy(new DOMException("insecure", "SecurityError")));
      return;
    }
    stopStream(streamRef.current);
    let lastError: unknown = new Error("camera");
    for (const constraints of cameraAttempts(nextFacing)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setFacing(nextFacing);
        setPhase("live");
        setStreamVersion((version) => version + 1);
        setError(null);
        return;
      } catch (caught) {
        lastError = caught;
        const name = caught instanceof DOMException ? caught.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          break;
        }
      }
    }
    setError(cameraErrorCopy(lastError));
  }

  async function takeStrip() {
    if (!slot || busy) return;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setError("The camera isn't ready yet. Wait a second, then try again.");
      return;
    }
    setBusy(true);
    setError(null);
    cancelRef.current = false;
    const taken: Blob[] = [];
    try {
      for (let index = 0; index < needed; index += 1) {
        for (const mark of ["3", "2", "1"]) {
          if (cancelRef.current) return;
          setCountLabel(mark);
          await wait(700);
        }
        if (cancelRef.current) return;
        setCountLabel("Smile");
        const jpeg = await frameToJpeg(
          video,
          video.videoWidth,
          video.videoHeight,
          slot,
          filter,
        );
        if (cancelRef.current) return;
        taken.push(jpeg);
        setShots([...taken]);
        await wait(400);
      }
      stopStream(streamRef.current);
      streamRef.current = null;
      setCountLabel(null);
      setPhase("review");
    } catch {
      setError(CAMERA_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function loadFromLibrary(list: FileList | null) {
    if (!slot || !list || list.length === 0) return;
    setError(null);
    if (list.length !== needed) {
      setError(
        layout === "4-cut"
          ? "A 4-cut strip needs 4 photos."
          : "A 2-cut strip needs 2 photos.",
      );
      return;
    }
    setBusy(true);
    try {
      const next: Blob[] = [];
      for (const file of list) {
        const bitmap = await createImageBitmap(file);
        const jpeg = await frameToJpeg(
          bitmap,
          bitmap.width,
          bitmap.height,
          slot,
          filter,
        );
        bitmap.close();
        next.push(jpeg);
      }
      setShots(next);
      setStripBlob(null);
      setPhase("review");
    } catch {
      setError(
        "Those photos couldn't be read. Try JPEGs, or take them with the camera.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium tracking-wide text-pine uppercase">
          {circleTitle}
        </p>
        <h1 className="mt-3 font-serif text-5xl tracking-tight">Photo booth</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
          Take the photos on this phone. The preview is mirrored. The strip is
          not, so words in the picture read the right way. Nothing is saved
          until you choose Save to this circle.
        </p>
      </div>

      {phase !== "review" ? (
        <fieldset
          className="flex flex-col gap-4"
          disabled={busy || phase === "live"}
        >
          <legend className="sr-only">Strip style</legend>
          <ChoiceRow label="Theme">
            {BOOTH_THEMES.map((value) => (
              <Choice
                key={value}
                name="theme-choice"
                pressed={theme === value}
                label={themeBundle(value).label}
                onChoose={() => setTheme(value)}
              />
            ))}
          </ChoiceRow>
          <p className="text-sm text-foreground/70">
            {themeBundle(theme).blurb}
          </p>
          <ChoiceRow label="Layout">
            {BOOTH_LAYOUTS.map((value) => (
              <Choice
                key={value}
                name="layout-choice"
                pressed={layout === value}
                label={layoutLabel(value)}
                onChoose={() => setLayout(value)}
              />
            ))}
          </ChoiceRow>
          <ChoiceRow label="Filter">
            {BOOTH_FILTERS.map((value) => (
              <Choice
                key={value}
                name="filter-choice"
                pressed={filter === value}
                label={filterLabel(value)}
                onChoose={() => setFilter(value)}
              />
            ))}
          </ChoiceRow>
        </fieldset>
      ) : null}

      {phase === "live" ? (
        <div className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-3xl bg-black">
            <video
              ref={videoRef}
              className="aspect-[3/4] w-full -scale-x-100 object-cover"
              autoPlay
              muted
              playsInline
              disablePictureInPicture
              aria-label="Camera preview, mirrored"
            />
            {countLabel ? (
              <p className="absolute inset-0 grid place-items-center font-serif text-7xl text-white">
                {countLabel}
              </p>
            ) : null}
          </div>
          <p className="text-sm text-foreground/70" role="status">
            {shots.length} of {needed} photos
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void takeStrip()}
              disabled={busy}
              className="h-12 rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
            >
              {busy ? "Hold still…" : `Take ${needed} photos`}
            </button>
            <button
              type="button"
              onClick={() =>
                void startCamera(facing === "user" ? "environment" : "user")
              }
              disabled={busy}
              className="h-12 rounded-full border border-line bg-card px-5 text-base font-medium"
            >
              Flip camera
            </button>
            <button
              type="button"
              onClick={resetShots}
              className="h-12 rounded-full px-5 text-base font-medium text-foreground/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase === "setup" ? (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy}
            className="h-12 rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
          >
            Use the camera
          </button>
          <div className="flex flex-col gap-2">
            <label htmlFor="booth-library" className="text-sm font-medium">
              Photos from your library
            </label>
            <input
              id="booth-library"
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              className="text-base"
              onChange={(event) => {
                void loadFromLibrary(event.target.files);
                event.target.value = "";
              }}
            />
            <p className="text-sm text-foreground/70">
              Choose {needed} photos if the camera is off, or if you would
              rather use pictures you already have.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="max-w-xl text-sm leading-6 text-accent" role="alert">
          {error}
        </p>
      ) : null}

      {phase === "review" && slot ? (
        <Review
          circleId={circleId}
          theme={theme}
          layout={layout}
          filter={filter}
          shots={shots}
          dateLabel={dateLabel}
          stripBlob={stripBlob}
          onStrip={setStripBlob}
          onRetake={resetShots}
        />
      ) : null}
    </div>
  );
}

function Review({
  circleId,
  theme,
  layout,
  filter,
  shots,
  dateLabel,
  stripBlob,
  onStrip,
  onRetake,
}: {
  circleId: string;
  theme: BoothTheme;
  layout: BoothLayout;
  filter: BoothFilter;
  shots: Blob[];
  dateLabel: string;
  stripBlob: Blob | null;
  onStrip: (blob: Blob) => void;
  onRetake: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: BoothActionState, formData: FormData) => {
      const shotBytes = await Promise.all(
        shots.map(async (blob) => new Uint8Array(await blob.arrayBuffer())),
      );
      return saveSoloBooth(previous, formData, shotBytes);
    },
    initialState,
  );
  const bundle = themeBundle(theme);

  return (
    <div className="flex flex-col gap-6">
      <PhotoStrip
        theme={theme}
        layout={layout}
        dateLabel={dateLabel}
        label={`${bundle.label} ${layoutLabel(layout)} photo booth strip`}
        sources={shots.map((blob, position) => ({ position, blob }))}
        onReady={onStrip}
      />
      <p className="text-sm text-foreground/70">
        {bundle.label} · {layoutLabel(layout)} · {filterLabel(filter)}. On an
        iPhone, if Download opens the strip instead of saving it, use the share
        sheet and choose Save Image.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!stripBlob}
          onClick={() => {
            if (stripBlob) void shareOrDownload(stripBlob, theme);
          }}
          className="h-12 rounded-full border border-line bg-card px-5 text-base font-medium disabled:opacity-60"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="h-12 rounded-full px-5 text-base font-medium text-foreground/70"
        >
          Retake
        </button>
      </div>
      <form
        className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-5"
        action={formAction}
      >
        <input type="hidden" name="circleId" value={circleId} />
        <input type="hidden" name="theme" value={theme} />
        <input type="hidden" name="layout" value={layout} />
        <input type="hidden" name="filter" value={filter} />
        <label htmlFor="booth-caption" className="text-sm font-medium">
          Caption, optional
        </label>
        <input
          id="booth-caption"
          name="caption"
          maxLength={MEMORY_CAPTION_MAX}
          className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          placeholder="A note under the strip"
        />
        {state.error ? (
          <p className="text-sm text-accent" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="text-sm text-pine" role="status">
            Saved on the memory wall.{" "}
            <Link
              href={`/circles/${circleId}#memory-heading`}
              className="font-medium"
            >
              See it on the wall
            </Link>
            .
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending || state.saved}
          className="h-12 rounded-full bg-pine px-5 text-base font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save to this circle"}
        </button>
      </form>
    </div>
  );
}

function ChoiceRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Choice({
  name,
  pressed,
  label,
  onChoose,
}: {
  name: string;
  pressed: boolean;
  label: string;
  onChoose: () => void;
}) {
  return (
    <label
      className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-medium leading-10 ${
        pressed
          ? "border-pine bg-pine text-white"
          : "border-line bg-card text-foreground"
      }`}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={pressed}
        onChange={onChoose}
      />
      {label}
    </label>
  );
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

async function shareOrDownload(blob: Blob, theme: BoothTheme): Promise<void> {
  const file = new File([blob], `hsummer-${theme}-strip.jpg`, {
    type: "image/jpeg",
  });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Hsummer photo booth" });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
