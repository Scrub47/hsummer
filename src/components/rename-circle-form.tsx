"use client";

import { useActionState } from "react";

import { renameCircle, type CircleActionState } from "@/app/circles/actions";

const initialState: CircleActionState = {
  error: null,
  inviteId: null,
  token: null,
  expiresAt: null,
};

export function RenameCircleForm({
  circleId,
  name,
}: {
  circleId: string;
  name: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    renameCircle,
    initialState,
  );
  const saved = state.error === null && state !== initialState;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="circleId" value={circleId} />
      <label htmlFor="rename-circle" className="text-sm font-medium">
        Circle name
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="rename-circle"
          name="name"
          maxLength={80}
          defaultValue={name ?? ""}
          placeholder="Me & Summer"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-card px-4 text-base"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center justify-center rounded-full bg-pine px-5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save name"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm leading-6" role="alert">
          {state.error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm leading-6 text-foreground/70" role="status">
          Saved.
        </p>
      ) : null}
    </form>
  );
}
