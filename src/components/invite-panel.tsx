"use client";

import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  regenerateInvite,
  setInviteCap,
  type CircleActionState,
  type InviteCapState,
} from "@/app/circles/actions";
import {
  COUPLE_CLOSED_MESSAGE,
  DEMO_READONLY_MESSAGE,
} from "@/lib/account/copy";
import {
  joinPath,
  type CircleStatus,
  type CircleType,
} from "@/lib/circles/fields";
import { readInviteToken, writeInviteToken } from "@/lib/circles/invite-token";
import type { CircleInviteView } from "@/lib/circles/load";

const initialState: CircleActionState = {
  error: null,
  inviteId: null,
  token: null,
  expiresAt: null,
};

const capInitial: InviteCapState = { error: null, saved: false };

export function InvitePanel({
  circleId,
  circleType = "couple",
  status,
  invite,
  closed = false,
  demo = false,
}: {
  circleId: string;
  circleType?: CircleType;
  status: CircleStatus;
  invite: CircleInviteView | null;
  closed?: boolean;
  demo?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    regenerateInvite,
    initialState,
  );
  const [cap, capAction, capPending] = useActionState(setInviteCap, capInitial);
  const [copied, setCopied] = useState(false);
  const inviteId = state.inviteId ?? invite?.id ?? null;
  const storedToken = useSyncExternalStore(
    subscribeToStorage,
    () => (inviteId ? readInviteToken(inviteId) : null),
    () => null,
  );
  const token = state.token ?? storedToken;

  useEffect(() => {
    if (!state.token || !state.inviteId) return;
    writeInviteToken(state.inviteId, state.token);
  }, [state.inviteId, state.token]);

  const full =
    invite !== null &&
    invite.maxUses !== null &&
    invite.useCount >= invite.maxUses &&
    !state.token;
  const canRegenerate =
    !demo &&
    !closed &&
    (circleType !== "couple" ||
      status === "pending" ||
      invite?.maxUses === null);
  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}${joinPath(token)}`
      : null;

  return (
    <section className="rounded-3xl border border-line bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Invite link</h2>
      {demo ? (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          {DEMO_READONLY_MESSAGE}
        </p>
      ) : closed ? (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          {COUPLE_CLOSED_MESSAGE}
        </p>
      ) : status === "pending" ? (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          {circleType === "couple"
            ? "Share this with your person. The bucket list, moods, and memory wall are already open. Thinking of You stays closed until you both are here. The link expires in 7 days, and a couple link works once."
            : "Share this with the people you want here. The link expires in 7 days. You can leave it open, or set how many people can use it."}
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          {full
            ? circleType === "couple"
              ? "This link has been used. A third person cannot join a couple circle with it."
              : "This link has reached its limit. Make a new one, or raise the limit."
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
      {circleType !== "couple" && !demo && invite ? (
        <form action={capAction} className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="circleId" value={circleId} />
          <label className="flex flex-col gap-2 text-sm font-medium">
            How many people can use this link
            <input
              name="maxUses"
              inputMode="numeric"
              placeholder="Leave blank for no limit"
              className="h-12 rounded-2xl border border-line bg-background px-4 text-base font-normal"
            />
          </label>
          {cap.error ? (
            <p className="text-sm" role="alert">
              {cap.error}
            </p>
          ) : null}
          {cap.saved && !cap.error ? (
            <p className="text-sm text-pine" role="status">
              Saved.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={capPending}
            className="h-11 w-fit rounded-full border border-line bg-background px-5 text-sm font-medium disabled:opacity-60"
          >
            {capPending ? "Saving…" : "Save limit"}
          </button>
        </form>
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
    } catch (error) {
      // Closing the sheet is not a failure. Copying afterwards would
      // replace whatever was already on the clipboard.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  } catch {
    setCopied(false);
  }
}
