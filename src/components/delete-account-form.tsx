"use client";

import { useActionState } from "react";

import {
  deleteAccount,
  type DeleteAccountState,
} from "@/app/profile/delete-actions";

const initial: DeleteAccountState = { error: null };

/**
 * Deletes the login. Personal data always goes. Shared contributions stay as
 * Former member unless the person chooses remove.
 */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, initial);

  return (
    <section className="rounded-3xl border border-line bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Delete account</h2>
      <p className="mt-3 text-sm leading-6 text-foreground/80">
        This removes your login, email, profile, photo, moods, pings, and
        notification devices. Download a copy first if you want one. The default
        keeps shared photos, notes, and letters in circles you were in, shown as
        Former member. Remove deletes those contributions. A circle with nobody
        left is kept for 30 days, then deleted.
      </p>
      <form action={action} className="mt-5 flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Shared contributions</legend>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="radio"
              name="choice"
              value="keep"
              defaultChecked
              className="mt-1"
            />
            <span>Keep them as Former member</span>
          </label>
          <label className="flex items-start gap-3 text-sm leading-6">
            <input type="radio" name="choice" value="remove" className="mt-1" />
            <span>Remove my photos, notes, sent letters, and booth frames</span>
          </label>
        </fieldset>
        <label
          className="flex flex-col gap-2 text-sm font-medium"
          htmlFor="confirm"
        >
          Type delete to confirm
          <input
            id="confirm"
            name="confirm"
            type="text"
            autoComplete="off"
            required
            className="h-12 rounded-2xl border border-line bg-background px-4 text-base font-normal outline-none ring-pine/40 focus:ring-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete my account"}
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
