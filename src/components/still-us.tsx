"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  addCheckpoint,
  deleteCheckpoint,
  markCheckpointHit,
  saveCountdown,
  type CountdownActionState,
} from "@/app/circles/countdown-actions";
import { HeartBurst } from "@/components/heart-burst";
import { LiveDot } from "@/components/live-dot";
import { useCircleLive } from "@/components/use-circle-live";
import { tapFeedback } from "@/lib/feel/feedback";
import {
  CHECKPOINT_LABEL_MAX,
  COUNTDOWN_LABEL_MAX,
} from "@/lib/countdowns/fields";
import type { CheckpointCard, CountdownCard } from "@/lib/countdowns/load";

const initialState: CountdownActionState = { error: null, saved: false };

/**
 * Still Us. A couple has one countdown. Days are calendar days in the
 * viewer's timezone. Checkpoints are hit on their date, or when someone taps.
 */
export function StillUs({
  circleId,
  circleType,
  countdowns,
  checkpoints,
}: {
  circleId: string;
  circleType: string;
  countdowns: CountdownCard[];
  checkpoints: CheckpointCard[];
}) {
  const router = useRouter();
  const live = useCircleLive(circleId, "checkpoints", () => router.refresh());
  const couple = circleType === "couple";

  return (
    <section aria-labelledby="still-us-heading" className="flex flex-col gap-6">
      <div>
        <h2
          id="still-us-heading"
          className="font-serif text-3xl tracking-tight"
        >
          Still Us
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/80">
          {couple
            ? "One countdown for the two of you. The days are counted in your own timezone."
            : "A countdown for a day you're aiming at. Days are counted in your own timezone."}
        </p>
        <LiveDot live={live} />
      </div>

      {countdowns.length === 0 ? (
        <CountdownForm circleId={circleId} countdown={null} />
      ) : (
        countdowns.map((countdown) => (
          <CountdownBlock
            key={countdown.id}
            circleId={circleId}
            countdown={countdown}
            checkpoints={checkpoints.filter(
              (checkpoint) => checkpoint.countdownId === countdown.id,
            )}
          />
        ))
      )}

      {!couple && countdowns.length > 0 ? (
        <CountdownForm circleId={circleId} countdown={null} />
      ) : null}
    </section>
  );
}

function CountdownBlock({
  circleId,
  countdown,
  checkpoints,
}: {
  circleId: string;
  countdown: CountdownCard;
  checkpoints: CheckpointCard[];
}) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-line bg-card p-5">
      <div>
        <p className="text-sm font-medium text-pine">{countdown.label}</p>
        {countdown.daysText && countdown.targetLabel ? (
          <>
            <p className="mt-2 font-serif text-5xl tracking-tight">
              {countdown.daysText}
            </p>
            <p className="mt-2 text-sm text-foreground/70">
              {countdown.targetLabel}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm leading-6 text-foreground/70">
            Pick the day you see each other again.
          </p>
        )}
      </div>
      <CountdownForm circleId={circleId} countdown={countdown} />
      <ul className="flex flex-col gap-3">
        {checkpoints.map((checkpoint) => (
          <li key={checkpoint.id}>
            <CheckpointRow circleId={circleId} checkpoint={checkpoint} />
          </li>
        ))}
      </ul>
      <CheckpointForm circleId={circleId} countdownId={countdown.id} />
    </div>
  );
}

function CountdownForm({
  circleId,
  countdown,
}: {
  circleId: string;
  countdown: CountdownCard | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveCountdown,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="circleId" value={circleId} />
      {countdown ? (
        <input type="hidden" name="countdownId" value={countdown.id} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label
            htmlFor={countdown ? `still-label-${countdown.id}` : "still-label"}
            className="text-sm font-medium"
          >
            Name
          </label>
          <input
            id={countdown ? `still-label-${countdown.id}` : "still-label"}
            name="label"
            maxLength={COUNTDOWN_LABEL_MAX}
            defaultValue={countdown?.label ?? "Still Us"}
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor={countdown ? `still-date-${countdown.id}` : "still-date"}
            className="text-sm font-medium"
          >
            Reunion date
          </label>
          <input
            id={countdown ? `still-date-${countdown.id}` : "still-date"}
            name="targetDate"
            type="date"
            required
            defaultValue={countdown?.targetDate ?? ""}
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
      </div>
      {state.error ? (
        <p className="text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved && !state.error ? (
        <p className="text-sm text-pine" role="status">
          Saved.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-12 self-start rounded-full bg-accent px-5 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : countdown
            ? "Save the date"
            : "Start the countdown"}
      </button>
    </form>
  );
}

function CheckpointForm({
  circleId,
  countdownId,
}: {
  circleId: string;
  countdownId: string;
}) {
  const [state, formAction, pending] = useActionState(
    addCheckpoint,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="countdownId" value={countdownId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`checkpoint-label-${countdownId}`}
            className="text-sm font-medium"
          >
            Checkpoint
          </label>
          <input
            id={`checkpoint-label-${countdownId}`}
            name="label"
            required
            maxLength={CHECKPOINT_LABEL_MAX}
            placeholder="Flight booked"
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`checkpoint-date-${countdownId}`}
            className="text-sm font-medium"
          >
            Checkpoint date
          </label>
          <input
            id={`checkpoint-date-${countdownId}`}
            name="date"
            type="date"
            required
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">How it hits</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="trigger"
            value="auto-by-date"
            defaultChecked
          />
          On this date, the first time one of you opens Hsummer
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="trigger" value="manual" />
          When one of you marks it
        </label>
      </fieldset>
      {state.error ? (
        <p className="text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 self-start rounded-full border border-line bg-card px-4 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add checkpoint"}
      </button>
    </form>
  );
}

function CheckpointRow({
  circleId,
  checkpoint,
}: {
  circleId: string;
  checkpoint: CheckpointCard;
}) {
  const [hitState, hitAction, hitting] = useActionState(
    markCheckpointHit,
    initialState,
  );
  const [removeState, removeAction, removing] = useActionState(
    deleteCheckpoint,
    initialState,
  );
  useEffect(() => {
    if (!hitState.saved) return;
    tapFeedback("milestone");
  }, [hitState.saved]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{checkpoint.label}</p>
        <p className="text-sm text-foreground/70">{checkpoint.dateLabel}</p>
      </div>
      <p className="text-sm text-foreground/70">
        {checkpoint.hitAt
          ? "Hit. It's on the memory wall."
          : checkpoint.trigger === "auto-by-date"
            ? "Hits on this date, in whoever's timezone reaches it first."
            : "Waiting for one of you to mark it."}
      </p>
      {hitState.saved ? <HeartBurst label="Still Us" /> : null}
      {checkpoint.trigger === "manual" && !checkpoint.hitAt ? (
        <form action={hitAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="checkpointId" value={checkpoint.id} />
          {hitState.error ? (
            <p className="mb-2 text-sm text-accent" role="alert">
              {hitState.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={hitting}
            className="h-10 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-60"
          >
            {hitting ? "Marking…" : "Mark hit"}
          </button>
        </form>
      ) : null}
      {!checkpoint.hitAt ? (
        <form action={removeAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <input type="hidden" name="checkpointId" value={checkpoint.id} />
          {removeState.error ? (
            <p className="mb-2 text-sm text-accent" role="alert">
              {removeState.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={removing}
            className="text-sm text-foreground/70 underline decoration-foreground/30"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
