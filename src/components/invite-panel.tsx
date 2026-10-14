"use client";

import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  regenerateInvite,
  type CircleActionState,
} from "@/app/circles/actions";
import {
  inviteStorageKey,
  joinPath,
  type CircleStatus,
} from "@/lib/circles/fields";
import type { CircleInviteView } from "@/lib/circles/load";

const initialState: CircleActionState = {
  error: null,
  inviteId: null,
  token: null,
  expiresAt: null,
};

export function InvitePanel({
  circleId,
  status,
  invite,
}: {
  circleId: string;
  status: CircleStatus;
  invite: CircleInviteView | null;
}) {
  const [state, formAction, pending] = useActionState(
    regenerateInvite,
    initialState,
  );
  const [copied, setCopied] = useState(false);
  const inviteId = state.inviteId ?? invite?.id ?? null;
  const storedToken = useSyncExternalStore(
    subscribeToStorage,
    () =>
      inviteId ? sessionStorage.getItem(inviteStorageKey(inviteId)) : null,
    () => null,
  );
  const token = state.token ?? storedToken;

  useEffect(() => {
    if (!state.token || !state.inviteId) return;
    sessionStorage.setItem(inviteStorageKey(state.inviteId), state.token);
  }, [state.inviteId, state.token]);

  const full =
    invite !== null &&
    invite.maxUses !== null &&
    invite.useCount >= invite.maxUses &&
    !state.token;
  const canRegenerate = status === "pending" || invite?.maxUses === null;
  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}${joinPath(token)}`
      : null;

  return (
    <section className="rounded-3xl border border-line bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Invite link</h2>
      {status === "pending" ? (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          Share this with your person. The bucket list and moods are already
          open. Thinking of You stays closed until you both are here. The link
          expires in 7 days, and a couple link works once.
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          {full
            ? "This link has been used. A third person cannot join a couple circle with it."
            : "Anyone with the link can ask to join until it expires."}
        </p>
      )}

      {link ? (
        <p className="mt-4 break-all text-sm leading-6">
          <a className="text-pine underline decoration-pine/40" href={link}>
            {link}
          </a>
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-foreground/70">
          The link is shown once, when you create it. Generate a new one if you
          don&apos;t have it anymore. That turns the old link off.
        </p>
      )}

      {invite ? (
        <p className="mt-3 text-sm text-foreground/70">
          {invite.maxUses === null
            ? `Used ${invite.useCount} times`
            : `Used ${invite.useCount} of ${invite.maxUses}`}
          {" · "}
          Expires {formatWhen(state.expiresAt ?? invite.expiresAt)}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        {link ? (
          <>
            <button
              type="button"
              onClick={() => share(link, setCopied)}
              className="inline-flex h-11 items-center justify-center rounded-full bg-pine px-5 text-sm font-medium text-white"
            >
              {copied ? "Copied" : "Share link"}
            </button>
          </>
        ) : null}
        {canRegenerate ? (
          <form action={formAction}>
            <input type="hidden" name="circleId" value={circleId} />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line bg-background px-5 text-sm font-medium disabled:opacity-60"
            >
              {pending ? "Making a new link…" : "Make a new link"}
            </button>
          </form>
        ) : null}
      </div>
      {state.error ? (
        <p className="mt-4 text-sm leading-6" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function share(
  url: string,
  setCopied: (copied: boolean) => void,
): Promise<void> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Join my circle on Hsummer", url });
      return;
    } catch {
      // The person dismissed the sheet, or this browser has no share target.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  } catch {
    setCopied(false);
  }
}
