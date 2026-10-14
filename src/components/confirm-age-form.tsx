"use client";

import { useActionState } from "react";

import { confirmAge, type ConfirmAgeState } from "@/app/confirm-age/actions";

const initial: ConfirmAgeState = { error: null };

export function ConfirmAgeForm({ nextPath }: { nextPath: string }) {
  const [state, action, pending] = useActionState(confirmAge, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={nextPath} />
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          name="age"
          value="yes"
          required
          className="mt-1"
        />
        <span>I am 13 or older</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
      {state.error ? (
        <p className="text-sm leading-6" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
