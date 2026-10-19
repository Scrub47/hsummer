"use client";

import { useActionState } from "react";

import { leaveCircle, type LeaveState } from "@/app/circles/leave-actions";

const initial: LeaveState = { error: null };

/**
 * Leaves this circle. Keep is the default. Remove deletes this person's
 * photos, notes, sent letters, and booth frames here. Shared plans stay.
 */
export function LeaveCircleForm({ circleId }: { circleId: string }) {
  const [state, action, pending] = useActionState(leaveCircle, initial);

  return (
    <section className="rounded-3xl border border-line bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Leave this circle</h2>
      <p className="mt-3 text-sm leading-6 text-foreground/80">
        You stop seeing this circle. Scheduled letters to or from you are
        cancelled. The default keeps your photos, notes, and letters here, under
        your name. You can download a copy from your profile first.
      </p>
      <form action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="circleId" value={circleId} />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Your contributions</legend>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="radio"
              name="choice"
              value="keep"
              defaultChecked
              className="mt-1"
            />
            <span>Keep them in the circle</span>
          </label>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input type="radio" name="choice" value="remove" className="mt-1" />
            <span>
              Remove my photos, notes, sent letters, and booth frames. Shared
              plans stay. A strip that was only mine is deleted. A shared strip
              keeps the other person&apos;s frames.
            </span>
          </label>
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-fit items-center justify-center rounded-full border border-line bg-background px-5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Leaving…" : "Leave circle"}
        </button>
        {state.error ? (
          <p className="text-sm leading-6" role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
