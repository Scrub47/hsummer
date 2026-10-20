"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import {
  addLetterCategory,
  cancelLetter,
  deleteLetterCategory,
  openLetter,
  rescheduleLetter,
  sendLetter,
  type LetterActionState,
} from "@/app/circles/letter-actions";
import { togglePin } from "@/app/circles/pin-actions";
import { EmptyState } from "@/components/empty-state";
import {
  LetterEnvelope,
  useEnvelopeMotion,
} from "@/components/letter-envelope";
import { trackProductEvent } from "@/lib/analytics/client";
import { LiveDot } from "@/components/live-dot";
import { MemberChoice } from "@/components/member-choice";
import { ReactionBar } from "@/components/reaction-bar";
import { useCircleLive } from "@/components/use-circle-live";
import { tapFeedback } from "@/lib/feel/feedback";
import {
  DEFAULT_LETTER_CATEGORIES,
  LETTER_BODY_MAX,
  LETTER_CATEGORY_MAX,
  LETTER_DESIGNS,
  LETTER_TITLE_MAX,
  type LetterDesign,
} from "@/lib/letters/fields";
import type { LetterCard, LetterCategory } from "@/lib/letters/view";
import type { ResponseView } from "@/lib/responses/load";
import { formatInZone } from "@/lib/schedule/time";

const initialState: LetterActionState = {
  error: null,
  saved: false,
  notice: null,
};

/**
 * Dear <name>. In a couple the other person is the recipient. A letter
 * they have not opened yet is a seal. Sending plays fold, seal, and
 * fly. Opening plays arrive, unseal, and slide. Then the words, and the
 * wall gains a memory only the two of them see.
 */
export function Letters({
  circleId,
  partnerName,
  partnerTimeZone,
  canWrite,
  pending,
  letters,
  categories,
  people = [],
  pinnedIds = [],
  responses = {},
}: {
  circleId: string;
  partnerName: string | null;
  partnerTimeZone: string;
  canWrite: boolean;
  pending: boolean;
  letters: LetterCard[];
  categories: LetterCategory[];
  people?: { userId: string; displayName: string; timezone: string }[];
  pinnedIds?: string[];
  responses?: Record<string, ResponseView>;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const live = useCircleLive(circleId, "letters", refresh);
  const [composing, setComposing] = useState(false);
  const canCompose = canWrite && (partnerName || people.length > 1);
  const pinned = new Set(pinnedIds);
  const keepsakes = letters.filter((letter) => pinned.has(letter.id));

  return (
    <section
      data-testid="letters"
      aria-labelledby="letters-heading"
      className="flex flex-col gap-6"
    >
      <div>
        <h2 id="letters-heading" className="font-serif text-3xl tracking-tight">
          Letters
        </h2>
        {pending ? (
          <p className="mt-1 text-sm text-muted">
            Letters open once you&apos;re both here.
          </p>
        ) : null}
        <LiveDot live={live} />
      </div>

      {keepsakes.length > 0 ? (
        <section
          aria-labelledby="keepsakes-heading"
          className="flex flex-col gap-3"
        >
          <h3 id="keepsakes-heading" className="font-hand text-3xl">
            Keepsakes
          </h3>
          <ul className="flex flex-col gap-3">
            {keepsakes.map((letter) => (
              <li key={`pin-${letter.id}`}>
                <LetterFold
                  circleId={circleId}
                  letter={letter}
                  partnerTimeZone={partnerTimeZone}
                  pinned
                  responses={responses[`letter:${letter.id}`]}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {letters.length === 0 ? (
        <EmptyState
          title="No letters yet"
          detail={
            canWrite && partnerName
              ? `The first one starts Dear ${partnerName}.`
              : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {letters.map((letter, index) => (
            <li key={letter.id} className="letter-fold">
              <LetterFold
                circleId={circleId}
                letter={letter}
                partnerTimeZone={partnerTimeZone}
                pinned={pinned.has(letter.id)}
                responses={responses[`letter:${letter.id}`]}
                startOpen={letter.sealed || index === 0}
              />
            </li>
          ))}
        </ul>
      )}

      {canCompose && composing ? (
        <WriteLetter
          circleId={circleId}
          partnerName={partnerName ?? "them"}
          partnerTimeZone={partnerTimeZone}
          categories={categories}
          people={people}
        />
      ) : null}
      {canCompose && !composing ? (
        <button
          type="button"
          className="btn w-fit"
          onClick={() => setComposing(true)}
        >
          Write a letter
        </button>
      ) : null}
      {canWrite && composing ? (
        <CategoryList circleId={circleId} categories={categories} />
      ) : null}
    </section>
  );
}

function LetterFold({
  circleId,
  letter,
  partnerTimeZone,
  pinned,
  responses,
  startOpen = true,
}: {
  circleId: string;
  letter: LetterCard;
  partnerTimeZone: string;
  pinned: boolean;
  responses?: ResponseView;
  startOpen?: boolean;
}) {
  return (
    <details className="fold" open={startOpen}>
      <summary>
        <span>
          {pinned ? "♥ " : ""}
          {letter.dearName}
        </span>
        <span className="text-sm font-medium text-muted">
          {letter.categoryLabel}
        </span>
      </summary>
      {letter.sealed ? (
        <SealedLetter
          circleId={circleId}
          letter={letter}
          pinned={pinned}
          responses={responses}
        />
      ) : (
        <OpenedLetter
          circleId={circleId}
          letter={letter}
          partnerTimeZone={partnerTimeZone}
          pinned={pinned}
          responses={responses}
        />
      )}
    </details>
  );
}

function WriteLetter({
  circleId,
  partnerName,
  partnerTimeZone,
  categories,
  people,
}: {
  circleId: string;
  partnerName: string;
  partnerTimeZone: string;
  categories: LetterCategory[];
  people: { userId: string; displayName: string; timezone: string }[];
}) {
  const [state, formAction, pending] = useActionState(sendLetter, initialState);
  const [design, setDesign] = useState<LetterDesign>("minimal");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [seenSaved, setSeenSaved] = useState(state.saved);
  const [flying, setFlying] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const skipAnimation = useRef(false);
  const flyingRef = useRef(false);
  const flightTimer = useRef<number | null>(null);
  const { ms } = useEnvelopeMotion();

  if (state.saved !== seenSaved) {
    setSeenSaved(state.saved);
    if (state.saved) {
      setWhen("now");
      setFlying(true);
    }
  }

  useEffect(() => {
    if (!state.saved) return;
    trackProductEvent("letter_sent");
    tapFeedback("seal");
    formRef.current?.reset();
  }, [state]);

  useEffect(() => {
    return () => {
      if (flightTimer.current !== null)
        window.clearTimeout(flightTimer.current);
    };
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (skipAnimation.current) {
      skipAnimation.current = false;
      flyingRef.current = false;
      setFlying(false);
      return;
    }
    event.preventDefault();
    if (flyingRef.current) return;
    flyingRef.current = true;
    setFlying(true);
    if (flightTimer.current !== null) window.clearTimeout(flightTimer.current);
    flightTimer.current = window.setTimeout(() => {
      skipAnimation.current = true;
      formRef.current?.requestSubmit();
    }, ms);
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="design" value={design} />
      <MemberChoice
        people={people}
        name="recipientId"
        legend="Who this letter is for"
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">When it arrives</legend>
        <div className="segment" role="group" aria-label="When it arrives">
          <label>
            <input
              type="radio"
              name="when"
              value="now"
              checked={when === "now"}
              onChange={() => setWhen("now")}
              className="sr-only"
            />
            Now
          </label>
          <label data-testid="letter-when-later">
            <input
              type="radio"
              name="when"
              value="later"
              checked={when === "later"}
              onChange={() => setWhen("later")}
              className="sr-only"
            />
            Later
          </label>
        </div>
        {when === "later" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="letter-deliver-date"
                className="text-sm font-medium"
              >
                Date
              </label>
              <input
                id="letter-deliver-date"
                name="deliverDate"
                type="date"
                required
                className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="letter-deliver-time"
                className="text-sm font-medium"
              >
                Time
              </label>
              <input
                id="letter-deliver-time"
                name="deliverTime"
                type="time"
                required
                defaultValue="08:00"
                className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
              />
            </div>
            <p className="text-sm leading-6 text-foreground/70 sm:col-span-2">
              {people.length > 1
                ? "8:00 AM means 8:00 AM in the recipient's timezone."
                : `This is ${partnerName}'s time (${partnerTimeZone}). 8:00 AM means 8:00 AM where they are.`}
            </p>
          </div>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="letter-category" className="text-sm font-medium">
            Open when
          </label>
          <select
            id="letter-category"
            name="category"
            required
            defaultValue="need-motivation"
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          >
            {DEFAULT_LETTER_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
            {categories.map((category) => (
              <option key={category.id} value={category.label}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="letter-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="letter-title"
            name="title"
            maxLength={LETTER_TITLE_MAX}
            placeholder="Optional"
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Design</legend>
        <div className="flex flex-wrap gap-2">
          {LETTER_DESIGNS.map((item) => (
            <label
              key={item.value}
              className={`flex h-10 cursor-pointer items-center rounded-full border px-4 text-sm font-medium ${
                design === item.value
                  ? "border-pine bg-pine text-white"
                  : "border-line bg-card"
              }`}
            >
              <input
                type="radio"
                name="design-choice"
                value={item.value}
                checked={design === item.value}
                onChange={() => setDesign(item.value)}
                className="sr-only"
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="letter-body" className="text-sm font-medium">
          Letter
        </label>
        <textarea
          id="letter-body"
          name="body"
          required
          rows={8}
          maxLength={LETTER_BODY_MAX}
          placeholder={`Dear ${partnerName},`}
          className="letter-body rounded-2xl border border-line bg-background px-4 py-3"
        />
      </div>
      {state.error ? (
        <p className="text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved && !state.error ? (
        <p className="text-sm text-pine" role="status">
          {state.notice ?? `Sent to ${partnerName}.`}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-full bg-accent px-5 text-base font-medium text-accent-ink disabled:opacity-60"
      >
        {pending || flying ? "Sending…" : "Send the letter"}
      </button>
      {flying ? <LetterEnvelope scene="send" /> : null}
    </form>
  );
}

function CategoryList({
  circleId,
  categories,
}: {
  circleId: string;
  categories: LetterCategory[];
}) {
  const [state, formAction, pending] = useActionState(
    addLetterCategory,
    initialState,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="circleId" value={circleId} />
        <label className="sr-only" htmlFor="letter-new-category">
          New category
        </label>
        <input
          id="letter-new-category"
          name="label"
          maxLength={LETTER_CATEGORY_MAX}
          placeholder="Add a category"
          className="h-12 flex-1 rounded-2xl border border-line bg-background px-4 text-base"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-full border border-line bg-card px-5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add category"}
        </button>
      </form>
      {state.error ? (
        <p className="text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
      {categories.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Custom categories">
          {categories.map((category) => (
            <li key={category.id}>
              <RemoveCategory circleId={circleId} category={category} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RemoveCategory({
  circleId,
  category,
}: {
  circleId: string;
  category: LetterCategory;
}) {
  const [state, formAction, pending] = useActionState(
    deleteLetterCategory,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="id" value={category.id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-line bg-card px-3 py-1 text-sm"
        aria-label={`Remove category ${category.label}`}
      >
        {category.label}
        <span aria-hidden> ×</span>
      </button>
      {state.error ? (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function OpenedLetter({
  circleId,
  letter,
  partnerTimeZone,
  pinned = false,
  responses,
}: {
  circleId: string;
  letter: LetterCard;
  partnerTimeZone: string;
  pinned?: boolean;
  responses?: ResponseView;
}) {
  const arrival =
    letter.status === "scheduled" && letter.scheduledFor
      ? formatInZone(letter.scheduledFor, partnerTimeZone)
      : null;

  return (
    <article
      id={`letter-${letter.id}`}
      className="letter-sheet"
      data-design={letter.design}
    >
      <p className="text-sm font-medium text-pine">{letter.categoryLabel}</p>
      <h3 className="font-hand mt-2 text-4xl">{letter.dearName}</h3>
      {letter.title ? (
        <p className="mt-3 text-base font-medium">{letter.title}</p>
      ) : null}
      {letter.body ? (
        <p className="letter-body mt-3 whitespace-pre-wrap">{letter.body}</p>
      ) : null}
      <p className="mt-4 text-sm text-foreground/70">
        {letter.status === "cancelled"
          ? "Cancelled. It won't arrive."
          : letter.status === "scheduled"
            ? arrival
              ? `Arrives ${arrival}, in their time.`
              : "Not delivered yet."
            : letter.mine
              ? letter.openedAt
                ? "You wrote this. They've opened it."
                : "You wrote this. The seal is still on it."
              : `From ${letter.fromName}.`}
      </p>
      {letter.mine && letter.status === "scheduled" ? (
        <ScheduledControls circleId={circleId} letterId={letter.id} />
      ) : null}
      <PinButton circleId={circleId} letterId={letter.id} pinned={pinned} />
      {letter.status === "delivered" ? (
        <ReactionBar
          circleId={circleId}
          targetKind="letter"
          targetId={letter.id}
          view={responses}
        />
      ) : null}
    </article>
  );
}

function PinButton({
  circleId,
  letterId,
  pinned,
}: {
  circleId: string;
  letterId: string;
  pinned: boolean;
}) {
  const [state, action, pending] = useActionState(togglePin, {
    error: null,
    saved: false,
  });
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="letterId" value={letterId} />
      <button type="submit" className="btn-quiet" disabled={pending}>
        {pending
          ? "Saving…"
          : pinned
            ? "Unpin from Keepsakes"
            : "Pin to Keepsakes"}
      </button>
      {state.error ? (
        <p className="mt-2 text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ScheduledControls({
  circleId,
  letterId,
}: {
  circleId: string;
  letterId: string;
}) {
  const [reschedule, rescheduleAction, rescheduling] = useActionState(
    rescheduleLetter,
    initialState,
  );
  const [cancel, cancelAction, cancelling] = useActionState(
    cancelLetter,
    initialState,
  );

  return (
    <div className="mt-4 flex flex-col gap-3">
      <form action={rescheduleAction} className="flex flex-col gap-3">
        <input type="hidden" name="circleId" value={circleId} />
        <input type="hidden" name="letterId" value={letterId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`reschedule-date-${letterId}`}
              className="text-sm font-medium"
            >
              New date
            </label>
            <input
              id={`reschedule-date-${letterId}`}
              name="deliverDate"
              type="date"
              required
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`reschedule-time-${letterId}`}
              className="text-sm font-medium"
            >
              New time
            </label>
            <input
              id={`reschedule-time-${letterId}`}
              name="deliverTime"
              type="time"
              required
              defaultValue="08:00"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base"
            />
          </div>
        </div>
        {reschedule.error ? (
          <p className="text-sm text-accent" role="alert">
            {reschedule.error}
          </p>
        ) : null}
        {reschedule.notice ? (
          <p className="text-sm text-pine" role="status">
            {reschedule.notice}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={rescheduling}
          className="h-10 self-start rounded-full border border-line bg-card px-4 text-sm font-medium disabled:opacity-60"
        >
          {rescheduling ? "Saving…" : "Change the time"}
        </button>
      </form>
      <form action={cancelAction}>
        <input type="hidden" name="circleId" value={circleId} />
        <input type="hidden" name="letterId" value={letterId} />
        {cancel.error ? (
          <p className="mb-2 text-sm text-accent" role="alert">
            {cancel.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={cancelling}
          className="text-sm font-medium text-foreground/70 underline decoration-foreground/30"
        >
          {cancelling ? "Cancelling…" : "Cancel this letter"}
        </button>
      </form>
    </div>
  );
}

function SealedLetter({
  circleId,
  letter,
  pinned = false,
  responses,
}: {
  circleId: string;
  letter: LetterCard;
  pinned?: boolean;
  responses?: ResponseView;
}) {
  const router = useRouter();
  const { ms } = useEnvelopeMotion();
  const [phase, setPhase] = useState<"sealed" | "opening" | "open">("sealed");
  const [body, setBody] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(letter.title);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  function onOpen() {
    if (phase !== "sealed") return;
    setError(null);
    setPhase("opening");
    timer.current = window.setTimeout(() => {
      void openLetter(circleId, letter.id).then((result) => {
        if (result.error || result.body == null) {
          setError(result.error ?? "That letter couldn't be opened.");
          setPhase("sealed");
          return;
        }
        setBody(result.body);
        setTitle(result.title);
        setPhase("open");
        trackProductEvent("letter_opened");
        tapFeedback("seal");
        router.refresh();
      });
    }, ms);
  }

  if (phase === "open" && body) {
    return (
      <OpenedLetter
        circleId={circleId}
        partnerTimeZone="UTC"
        pinned={pinned}
        responses={responses}
        letter={{
          ...letter,
          sealed: false,
          body,
          title,
          openedAt: letter.openedAt ?? new Date().toISOString(),
        }}
      />
    );
  }

  return (
    <article
      id={`letter-${letter.id}`}
      className={`letter-sheet ${phase === "opening" ? "is-opening" : ""}`}
      data-design={letter.design}
    >
      <p className="text-sm font-medium text-pine">{letter.categoryLabel}</p>
      <h3 className="font-hand mt-2 text-4xl">{letter.dearName}</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-foreground/70">
        From {letter.fromName}. The words are inside.
      </p>
      {phase === "opening" ? <LetterEnvelope scene="open" /> : null}
      <div className="mt-6 flex flex-col items-start gap-3">
        <button
          type="button"
          className="letter-seal"
          aria-label="Open letter"
          aria-busy={phase === "opening"}
          onClick={onOpen}
        >
          <span aria-hidden>{phase === "opening" ? "…" : "Open"}</span>
        </button>
        {error ? (
          <p className="text-sm text-accent" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}
