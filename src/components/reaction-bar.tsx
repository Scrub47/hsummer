"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  addReply,
  toggleReaction,
  type ResponseActionState,
} from "@/app/circles/response-actions";
import { trackProductEvent } from "@/lib/analytics/client";
import { tapFeedback } from "@/lib/feel/feedback";
import type { ResponseView } from "@/lib/responses/load";
import {
  REACTION_EMOJIS,
  REPLY_MAX,
  reactionGlyph,
} from "@/lib/settings/prefs";

const initial: ResponseActionState = { error: null, saved: false };

/**
 * Cozy reactions and a short reply. The server only stores these for people
 * who can already see the letter, photo, strip, or memory.
 */
export function ReactionBar({
  circleId,
  targetKind,
  targetId,
  view,
  locked = false,
}: {
  circleId: string;
  targetKind: "letter" | "memory";
  targetId: string;
  view?: ResponseView;
  locked?: boolean;
}) {
  const reactions = view?.reactions ?? [];
  const replies = view?.replies ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reactions">
        {REACTION_EMOJIS.map((emoji) => {
          const current = reactions.find((item) => item.emoji === emoji.code);
          if (locked) {
            const count = current?.count ?? 0;
            return (
              <span
                key={emoji.code}
                className="chip"
                aria-label={
                  count > 0 ? `${emoji.label}, ${count}` : emoji.label
                }
              >
                <span aria-hidden>{emoji.glyph}</span>
                {count > 0 ? <span>{count}</span> : null}
              </span>
            );
          }
          return (
            <ReactionButton
              key={emoji.code}
              circleId={circleId}
              targetKind={targetKind}
              targetId={targetId}
              emoji={emoji.code}
              glyph={emoji.glyph}
              label={emoji.label}
              count={current?.count ?? 0}
              mine={current?.mine ?? false}
            />
          );
        })}
      </div>
      {replies.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Replies">
          {replies.map((reply) => (
            <li key={reply.id} className="text-sm leading-6">
              <span className="font-bold">{reply.author}</span>{" "}
              <span className="whitespace-pre-wrap">{reply.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {locked ? null : (
        <ReplyForm
          circleId={circleId}
          targetKind={targetKind}
          targetId={targetId}
        />
      )}
    </div>
  );
}

function ReactionButton({
  circleId,
  targetKind,
  targetId,
  emoji,
  glyph,
  label,
  count,
  mine,
}: {
  circleId: string;
  targetKind: "letter" | "memory";
  targetId: string;
  emoji: string;
  glyph: string;
  label: string;
  count: number;
  mine: boolean;
}) {
  const [state, action, pending] = useActionState(toggleReaction, initial);
  const adding = useRef(false);

  useEffect(() => {
    if (!state.saved) return;
    if (adding.current) trackProductEvent("reaction_added");
    adding.current = false;
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="targetKind" value={targetKind} />
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="emoji" value={emoji} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={mine}
        aria-label={count > 0 ? `${label}, ${count}` : label}
        className={`chip ${mine ? "" : ""}`}
        data-mine={mine ? "true" : "false"}
        onClick={() => {
          adding.current = !mine;
          tapFeedback("mood");
        }}
      >
        <span aria-hidden>{glyph || reactionGlyph(emoji)}</span>
        {count > 0 ? <span>{count}</span> : null}
      </button>
      {state.error ? (
        <span className="sr-only" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function ReplyForm({
  circleId,
  targetKind,
  targetId,
}: {
  circleId: string;
  targetKind: "letter" | "memory";
  targetId: string;
}) {
  const [state, action, pending] = useActionState(addReply, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.saved) return;
    trackProductEvent("reply_sent");
    ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="circleId" value={circleId} />
      <input type="hidden" name="targetKind" value={targetKind} />
      <input type="hidden" name="targetId" value={targetId} />
      <label className="sr-only" htmlFor={`reply-${targetKind}-${targetId}`}>
        Reply
      </label>
      <div className="flex gap-2">
        <input
          id={`reply-${targetKind}-${targetId}`}
          name="body"
          maxLength={REPLY_MAX}
          placeholder="A short note"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-background px-4 text-base"
        />
        <button type="submit" className="btn-quiet" disabled={pending}>
          {pending ? "Sending…" : "Reply"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-accent" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
