"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  clearCurrentMood,
  setCurrentMood,
  type MoodActionState,
} from "@/app/circles/mood-actions";
import { ProfileAvatar } from "@/components/profile-avatar";
import { useCircleLive } from "@/components/use-circle-live";
import { MOODS, moodSavedMessage } from "@/lib/moods/fields";

const initialState: MoodActionState = {
  error: null,
  saved: false,
  shared: false,
  push: null,
};

export type MoodPerson = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type MoodRow = {
  userId: string;
  emoji: string;
  label: string;
  when: string;
};

/**
 * Set your mood with one tap. The share box is off until you check it, and
 * only then does the save also send a ping.
 */
export function CircleMoods({
  circleId,
  selfId,
  partnerName,
  waiting,
  canShare,
  members,
  moods,
}: {
  circleId: string;
  selfId: string;
  partnerName: string | null;
  waiting: boolean;
  canShare: boolean;
  members: MoodPerson[];
  moods: MoodRow[];
}) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  const live = useCircleLive(circleId, "current_moods", refresh);
  const [state, formAction, saving] = useActionState(
    setCurrentMood,
    initialState,
  );
  const [cleared, clearAction, clearing] = useActionState(
    clearCurrentMood,
    initialState,
  );
  const [formKey, setFormKey] = useState(0);
  const [latest, setLatest] = useState<"set" | "clear" | null>(null);
  const seen = useRef(state);
  const seenClear = useRef(cleared);
  const own = moods.find((mood) => mood.userId === selfId) ?? null;

  useEffect(() => {
    if (state.saved && state !== seen.current) {
      seen.current = state;
      setLatest("set");
      setFormKey((key) => key + 1);
    }
  }, [state]);

  useEffect(() => {
    if (cleared.saved && cleared !== seenClear.current) {
      seenClear.current = cleared;
      setLatest("clear");
    }
  }, [cleared]);

  const status =
    state.saved && latest !== "clear"
      ? moodSavedMessage({
          partnerName,
          waiting,
          shared: state.shared,
          push: state.push,
        })
      : null;

  return (
    <section aria-labelledby="mood-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="mood-heading" className="font-serif text-3xl tracking-tight">
          Mood
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/80">
          {waiting
            ? "A tap saves how you're feeling. They'll see it when they join. Thinking of You stays closed until you're both here."
            : canShare
              ? `${partnerName ?? "Your partner"} can see how you're feeling. A tap saves it here. Check the box to also send a notification.`
              : "Everyone here can see how you're feeling. A tap saves it here."}
        </p>
        <p className="mt-2 text-sm text-foreground/70" role="status">
          {live === "live"
            ? "Live. A new mood shows up here for everyone in the circle."
            : live === "connecting"
              ? "Connecting live updates…"
              : "Live updates aren't connected. Saves still stick. Reload to see someone else's mood."}
        </p>
      </div>

      <ul aria-label="Circle moods" className="flex flex-col gap-3">
        {members.map((member) => {
          const mood = moods.find((row) => row.userId === member.userId);
          const you = member.userId === selfId;
          return (
            <li
              key={member.userId}
              className="flex items-center gap-4 rounded-3xl border border-line bg-card px-4 py-3"
            >
              <ProfileAvatar
                name={member.displayName}
                url={member.avatarUrl}
                alt=""
                className="h-12 w-12 text-lg"
              />
              <span>
                <span className="block font-medium">
                  {member.displayName}
                  {you ? " (you)" : ""}
                </span>
                <span className="mt-1 block text-sm text-foreground/80">
                  {mood ? (
                    <>
                      <span aria-hidden="true">{mood.emoji} </span>
                      {mood.label}
                      {mood.when ? (
                        <span className="text-foreground/60">
                          {" "}
                          · {mood.when}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    "No mood yet"
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <form key={formKey} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="circleId" value={circleId} />
        <div
          role="group"
          aria-label="Your mood"
          className="flex flex-wrap gap-2"
        >
          {MOODS.map((mood) => {
            const pressed = own?.emoji === mood.emoji;
            return (
              <button
                key={mood.emoji}
                type="submit"
                name="emoji"
                value={mood.emoji}
                aria-pressed={pressed}
                disabled={saving || clearing}
                className={`inline-flex h-12 items-center gap-2 rounded-full border px-4 text-sm font-medium disabled:opacity-60 ${
                  pressed
                    ? "border-pine bg-pine text-white"
                    : "border-line bg-card"
                }`}
              >
                <span aria-hidden="true">{mood.emoji}</span>
                {mood.label}
              </button>
            );
          })}
        </div>
        {canShare ? (
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              name="share"
              className="mt-1 h-4 w-4 accent-pine"
            />
            <span>
              Also send this as a ping
              <span className="mt-1 block text-foreground/70">
                {partnerName
                  ? `Sends Thinking of You to ${partnerName}, with the same limit as that button.`
                  : "Sends Thinking of You to your partner."}
              </span>
            </span>
          </label>
        ) : null}
        {state.error ? (
          <p className="text-sm leading-6" role="alert">
            {state.saved ? `Your mood is saved. ${state.error}` : state.error}
          </p>
        ) : null}
        {status && !state.error ? (
          <p className="text-sm leading-6" role="status">
            {status}
          </p>
        ) : null}
      </form>

      {own ? (
        <form action={clearAction}>
          <input type="hidden" name="circleId" value={circleId} />
          <button
            type="submit"
            disabled={saving || clearing}
            className="text-sm font-medium text-pine underline decoration-pine/40 disabled:opacity-60"
          >
            {clearing ? "Clearing…" : "Clear mood"}
          </button>
        </form>
      ) : null}
      {cleared.error ? (
        <p className="text-sm leading-6" role="alert">
          {cleared.error}
        </p>
      ) : null}
      {latest === "clear" && cleared.saved && !cleared.error ? (
        <p className="text-sm leading-6" role="status">
          Cleared. No notification was sent.
        </p>
      ) : null}
    </section>
  );
}
