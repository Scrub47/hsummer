"use client";

import { useId, useState } from "react";

import { RatingControl, type Rating } from "@/components/rating-control";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_RATE_LIMIT_MESSAGE,
  type FeedbackCategory,
} from "@/lib/feedback/fields";

const labels: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  love: "Love",
};

export function FeedbackSheet({
  open,
  onClose,
  title,
  intro,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: string;
  /** Called after a note is stored, before the sheet closes. */
  onDone?: () => void;
}) {
  const titleId = useId();
  const ratingId = useId();
  const [rating, setRating] = useState<Rating | null>(null);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    if (rating == null || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating,
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(category ? { category } : {}),
        }),
      });
      if (response.status === 429) {
        setError(FEEDBACK_RATE_LIMIT_MESSAGE);
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "That note wasn't saved.");
        return;
      }
      onDone?.();
      onClose();
    } catch {
      setError("That note wasn't saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet prompt-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="font-serif text-2xl tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="text-sm leading-6 text-foreground/80">{intro}</p>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p id={ratingId} className="text-sm font-bold">
              Rating
            </p>
            <RatingControl
              value={rating}
              onChange={setRating}
              labelledBy={ratingId}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold">
              Category{" "}
              <span className="font-normal text-muted">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="chip"
                  aria-pressed={category === item}
                  onClick={() =>
                    setCategory((current) => (current === item ? null : item))
                  }
                >
                  {labels[item]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-2 text-sm font-bold">
            Message <span className="font-normal text-muted">(optional)</span>
            <textarea
              value={message}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={4}
              onChange={(event) => setMessage(event.target.value)}
              className="rounded-2xl border border-line bg-background px-4 py-3 text-base font-normal"
              placeholder="What should Isaac know?"
            />
            <span className="text-xs font-normal text-muted">
              {message.length} / {FEEDBACK_MESSAGE_MAX}
            </span>
          </label>
          {error ? (
            <p className="text-sm text-accent" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn"
              disabled={rating == null || pending}
              onClick={() => void submit()}
            >
              {pending ? "Sending…" : "Send"}
            </button>
            <button type="button" className="btn-quiet" onClick={onClose}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
