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
  cancelPassBooth,
  startPassBooth,
  submitPassTurn,
  type PassActionState,
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
  PASS_GROUP,
  PASS_PENDING,
  PASS_UNAVAILABLE,
  SHOT_JPEG_QUALITY,
  creatorPositions,
  filterLabel,
  layoutLabel,
  type BoothFilter,
  type BoothLayout,
  type BoothTheme,
  type PassBlocked,
  type PassTurn,
} from "@/lib/booth/fields";
import { applyFilter } from "@/lib/booth/filters";
import { coverCrop, frameSlots, type Slot } from "@/lib/booth/layout";
import { assignShotFiles } from "@/lib/booth/shot-files";
import { MEMORY_CAPTION_MAX } from "@/lib/memories/fields";
import { themeBundle } from "@/lib/booth/themes";

const initialState: PassActionState = { error: null, notice: null };

/**
 * Pass the Booth. The starter takes the top frames. The partner takes the
 * rest later. Nothing is published until every frame is in.
 */
export function PassBooth({
  circleId,
  canStart,
  blocked,
  partnerName,
  turns,
  unavailable,
}: {
  circleId: string;
  canStart: boolean;
  blocked: PassBlocked | null;
  partnerName: string | null;
  turns: PassTurn[];
  unavailable: boolean;
}) {
  const yours = turns.find(
    (turn) => turn.waitingOnYou && turn.status === "open",
  );
  const waiting = turns.filter(
    (turn) => turn.status === "open" && !turn.waitingOnYou,
  );
  const closed = turns.filter((turn) => turn.status !== "open");

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-xl text-base leading-7 text-foreground/80">
        You take your frames now. {partnerName ?? "Your partner"} takes theirs
        whenever they can. The strip shows up for both of you when the last
        frame is in. It closes after 7 days if it is still open.
      </p>
      {unavailable ? (
        <p className="text-sm leading-6 text-foreground/70">
          {PASS_UNAVAILABLE}
        </p>
      ) : null}
      {yours ? <TurnShoot circleId={circleId} turn={yours} /> : null}
      {waiting.map((turn) => (
        <WaitingCard key={turn.sessionId} circleId={circleId} turn={turn} />
      ))}
      {closed.map((turn) => (
        <p key={turn.sessionId} className="text-sm text-foreground/70">
          {turn.status === "expired"
            ? `A booth expired${turn.expiresLabel ? ` on ${turn.expiresLabel}` : ""}. The unfinished frames were removed.`
            : "A booth was cancelled. The unfinished frames were removed."}
        </p>
      ))}
      {!unavailable && !yours && canStart && partnerName ? (
        <StartPass circleId={circleId} partnerName={partnerName} />
      ) : null}
      {!unavailable && !canStart && !yours && waiting.length === 0 ? (
        <p className="text-sm leading-6 text-foreground/80">
          {blocked === "pending"
            ? PASS_PENDING
            : blocked === "group"
              ? PASS_GROUP
              : "Pass the booth needs both of you in this circle."}
        </p>
      ) : null}
    </div>
  );
}

function WaitingCard({ circleId, turn }: { circleId: string; turn: PassTurn }) {
  const [state, formAction, pending] = useActionState(
    cancelPassBooth,
    initialState,
  );
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-line bg-card p-5">
      <p className="font-medium">Waiting for {turn.partnerName}</p>
      <p className="text-sm leading-6 text-foreground/70">
        Your frames are in. {turn.partnerName} still has theirs.
        {turn.expiresLabel ? ` This closes ${turn.expiresLabel}.` : ""}
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="circleId" value={circleId} />
        <input type="hidden" name="sessionId" value={turn.sessionId} />
        {state.error ? (
          <p className="text-sm text-accent" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="text-sm text-pine" role="status">
            {state.notice}
          </p>
        ) : null}
        {turn.startedByMe ? (
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-fit rounded-full border border-line bg-background px-5 text-base font-medium disabled:opacity-60"
          >
            {pending ? "Cancelling…" : "Cancel this booth"}
          </button>
        ) : null}
      </form>
    </div>
  );
}

function TurnShoot({ circleId, turn }: { circleId: string; turn: PassTurn }) {
  return (
    <Capture
      title={`Your turn, ${turn.partnerName} already took theirs`}
      detail={
        turn.expiresLabel
          ? `Take ${turn.myPositions.length} photos. This closes ${turn.expiresLabel}.`
          : `Take ${turn.myPositions.length} photos.`
      }
      theme={turn.theme}
      layout={turn.layout}
      lockStyle
      positions={turn.myPositions}
      existing={turn.frames}
      action={submitPassTurn}
      hidden={{
        circleId,
        sessionId: turn.sessionId,
      }}
      submitLabel="Add your frames"
      doneHref={`/circles/${circleId}#memory-heading`}
    />
  );
}

function StartPass({
  circleId,
  partnerName,
}: {
  circleId: string;
  partnerName: string;
}) {
  const [theme, setTheme] = useState<BoothTheme>("kawaii");
  const [layout, setLayout] = useState<BoothLayout>("4-cut");
  const [filter, setFilter] = useState<BoothFilter>("none");
  const positions = creatorPositions(layout);
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="sr-only">Strip style</legend>
        <ChoiceRow label="Theme">
          {BOOTH_THEMES.map((value) => (
            <Choice
              key={value}
              name="pass-theme"
              pressed={theme === value}
              label={themeBundle(value).label}
              onChoose={() => setTheme(value)}
            />
          ))}
        </ChoiceRow>
        <ChoiceRow label="Layout">
          {BOOTH_LAYOUTS.map((value) => (
            <Choice
              key={value}
              name="pass-layout"
              pressed={layout === value}
              label={layoutLabel(value)}
              onChoose={() => setLayout(value)}
            />
          ))}
        </ChoiceRow>
        <ChoiceRow label="Your filter">
          {BOOTH_FILTERS.map((value) => (
            <Choice
              key={value}
              name="pass-filter"
              pressed={filter === value}
              label={filterLabel(value)}
              onChoose={() => setFilter(value)}
            />
          ))}
        </ChoiceRow>
        <p className="text-sm text-foreground/70">
          {partnerName} picks a filter when they take their frames.
        </p>
      </fieldset>
      <Capture
        key={`${theme}-${layout}-${filter}`}
        title={`Your ${positions.length} frames`}
        detail={`Then pass it to ${partnerName}.`}
        theme={theme}
        layout={layout}
        lockStyle={false}
        positions={positions}
        existing={[]}
        filter={filter}
        action={startPassBooth}
        hidden={{ circleId, theme, layout }}
        caption
        submitLabel={`Pass it to ${partnerName}`}
        doneHref={null}
      />
    </div>
  );
}

function Capture({
  title,
  detail,
  theme,
  layout,
  lockStyle,
  positions,
  existing,
  filter: fixedFilter,
  action,
  hidden,
  caption,
  submitLabel,
  doneHref,
}: {
  title: string;
  detail: string;
  theme: BoothTheme;
  layout: BoothLayout;
  lockStyle: boolean;
  positions: number[];
  existing: { position: number; url: string | null }[];
  filter?: BoothFilter;
  action: (
    previous: PassActionState,
    formData: FormData,
  ) => Promise<PassActionState>;
  hidden: Record<string, string>;
  caption?: boolean;
  submitLabel: string;
  doneHref: string | null;
}) {
  const [ownFilter, setOwnFilter] = useState<BoothFilter>("none");
  const filter = fixedFilter ?? ownFilter;
  const setFilter = setOwnFilter;
  const [phase, setPhase] = useState<"setup" | "live" | "review">("setup");
  const [facing, setFacing] = useState<CameraFacing>("user");
  const [error, setError] = useState<string | null>(null);
  const [countLabel, setCountLabel] = useState<string | null>(null);
  const [shots, setShots] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const slot = frameSlots(layout, themeBundle(theme))[0];
  const needed = positions.length;

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

  async function startCamera(nextFacing = facing) {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
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

  async function takeFrames() {
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
        needed === 1
          ? "This turn needs 1 photo."
          : `This turn needs ${needed} photos.`,
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
      setPhase("review");
    } catch {
      setError(
        "Those photos couldn't be read. Try JPEGs, or take them with the camera.",
      );
    } finally {
      setBusy(false);
    }
  }

  const frameCount = layout === "4-cut" ? 4 : 2;
  const sources = Array.from({ length: frameCount }, (_, position) => {
    const index = positions.indexOf(position);
    const shot = index >= 0 ? shots[index] : undefined;
    if (shot) return { position, blob: shot };
    const prior = existing.find((frame) => frame.position === position);
    return { position, url: prior?.url ?? null };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-3xl tracking-tight">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/70">{detail}</p>
      </div>
      {phase === "review" && slot ? (
        <Review
          theme={theme}
          layout={layout}
          sources={sources}
          shots={shots}
          action={action}
          hidden={{ ...hidden, filter }}
          caption={caption ?? false}
          submitLabel={submitLabel}
          doneHref={doneHref}
          onRetake={() => {
            cancelRef.current = true;
            stopStream(streamRef.current);
            streamRef.current = null;
            setShots([]);
            setPhase("setup");
          }}
        />
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
              onClick={() => void takeFrames()}
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
              onClick={() => {
                cancelRef.current = true;
                stopStream(streamRef.current);
                streamRef.current = null;
                setShots([]);
                setPhase("setup");
                setBusy(false);
              }}
              className="h-12 rounded-full px-5 text-base font-medium text-foreground/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {phase === "setup" ? (
        <div className="flex flex-col gap-4">
          {lockStyle ? (
            <ChoiceRow label="Your filter">
              {BOOTH_FILTERS.map((value) => (
                <Choice
                  key={value}
                  name={`turn-filter-${hidden.sessionId ?? "start"}`}
                  pressed={filter === value}
                  label={filterLabel(value)}
                  onChoose={() => setFilter(value)}
                />
              ))}
            </ChoiceRow>
          ) : null}
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy}
            className="h-12 w-fit rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
          >
            Use the camera
          </button>
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`pass-library-${hidden.sessionId ?? "start"}`}
              className="text-sm font-medium"
            >
              Photos for your frames
            </label>
            <input
              id={`pass-library-${hidden.sessionId ?? "start"}`}
              type="file"
              accept="image/*"
              multiple={needed > 1}
              disabled={busy}
              className="text-base"
              onChange={(event) => {
                void loadFromLibrary(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="max-w-xl text-sm leading-6 text-accent" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Review({
  theme,
  layout,
  sources,
  shots,
  action,
  hidden,
  caption,
  submitLabel,
  doneHref,
  onRetake,
}: {
  theme: BoothTheme;
  layout: BoothLayout;
  sources: { position: number; url?: string | null; blob?: Blob | null }[];
  shots: Blob[];
  action: (
    previous: PassActionState,
    formData: FormData,
  ) => Promise<PassActionState>;
  hidden: Record<string, string>;
  caption: boolean;
  submitLabel: string;
  doneHref: string | null;
  onRetake: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  return (
    <div className="flex flex-col gap-4">
      <PhotoStrip
        theme={theme}
        layout={layout}
        dateLabel={dateLabel}
        label={`${themeBundle(theme).label} ${layoutLabel(layout)} photo booth strip`}
        sources={sources}
      />
      <form className="flex flex-col gap-4" action={formAction}>
        <input
          ref={(node) => {
            if (node) assignShotFiles(node, shots);
          }}
          type="file"
          name="shot"
          multiple
          accept="image/jpeg"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {caption ? (
          <>
            <label htmlFor="pass-caption" className="text-sm font-medium">
              Caption, optional
            </label>
            <input
              id="pass-caption"
              name="caption"
              maxLength={MEMORY_CAPTION_MAX}
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
              placeholder="A note under the strip"
            />
          </>
        ) : null}
        {state.error ? (
          <p className="text-sm text-accent" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="text-sm text-pine" role="status">
            {state.notice}{" "}
            {doneHref && state.notice.includes("memory wall") ? (
              <Link href={doneHref} className="font-medium">
                See it on the wall
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending || Boolean(state.notice)}
            className="h-12 rounded-full bg-pine px-5 text-base font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="h-12 rounded-full px-5 text-base font-medium text-foreground/70"
          >
            Retake
          </button>
        </div>
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

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
