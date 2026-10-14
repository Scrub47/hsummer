"use client";

import { useActionState } from "react";

import { setCircleMute, type MuteState } from "@/app/circles/actions";
import { muteStatus } from "@/lib/push/batch";

const initial: MuteState = { error: null, saved: false };

/** Per-circle mute for a group. Couples and the demo circle do not render this. */
export function CircleMute({
  circleId,
  mutedUntil,
}: {
  circleId: string;
  mutedUntil: string | null;
}) {
  const [state, formAction, pending] = useActionState(setCircleMute, initial);
  const status = muteStatus(mutedUntil, Date.now());

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl tracking-tight">Notifications</h2>
      <p className="max-w-xl text-sm leading-6 text-foreground/80">
        {status ??
          "A busy circle sends one notification, then waits a minute before the next. Mute this circle if you want it quiet."}
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="circleId" value={circleId} />
        <label className="flex flex-col gap-2 text-sm font-medium">
          Mute
          <select
            name="mute"
            defaultValue="off"
            className="h-12 rounded-2xl border border-line bg-card px-4 text-base font-normal"
          >
            <option value="off">On</option>
            <option value="hour">For an hour</option>
            <option value="day">For a day</option>
            <option value="until-off">Until I turn this off</option>
          </select>
        </label>
        {state.error ? (
          <p className="text-sm" role="alert">
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
          className="h-12 w-fit rounded-full border border-line bg-background px-5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
