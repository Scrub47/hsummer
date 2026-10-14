"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { createCircle, type CreateCircleState } from "@/app/circles/actions";
import { writeInviteToken } from "@/lib/circles/invite-token";

const initialState: CreateCircleState = {
  error: null,
  circleId: null,
  inviteId: null,
  token: null,
  expiresAt: null,
};

export function CircleCreateForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createCircle,
    initialState,
  );

  useEffect(() => {
    if (!state.token || !state.inviteId || !state.circleId) return;
    writeInviteToken(state.inviteId, state.token);
    router.push(`/circles/${state.circleId}`);
  }, [router, state.circleId, state.inviteId, state.token]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Kind of circle</legend>
        {(
          [
            ["couple", "Couple"],
            ["group", "Group"],
            ["family", "Family"],
            ["friends", "Friends"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-3 text-sm">
            <input
              type="radio"
              name="circleType"
              value={value}
              defaultChecked={value === "couple"}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="circle-name" className="text-sm font-medium">
          Name{" "}
          <span className="font-normal text-foreground/60">(optional)</span>
        </label>
        <input
          id="circle-name"
          name="name"
          maxLength={80}
          placeholder="Me & Summer"
          autoComplete="off"
          className="h-12 rounded-2xl border border-line bg-card px-4 text-base"
        />
        <p className="text-sm leading-6 text-foreground/70">
          A couple starts with you. That invite link works once. A group,
          family, or friends link can be used until it expires, or until you
          set a limit.
        </p>
      </div>
      {state.error ? (
        <p
          className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create a circle"}
      </button>
    </form>
  );
}
