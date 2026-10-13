import type { Metadata } from "next";
import Link from "next/link";

import { redeemInvite } from "@/app/join/actions";
import {
  circleTitle,
  inviteStateMessage,
  isCircleType,
  isInviteState,
  isInviteToken,
  joinPath,
} from "@/lib/circles/fields";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Join a circle",
};

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const errorCode = typeof query.error === "string" ? query.error : undefined;
  const errorMessage =
    errorCode && isInviteState(errorCode)
      ? inviteStateMessage(errorCode)
      : errorCode
        ? inviteStateMessage("missing")
        : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 py-10">
      <header>
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-4xl tracking-tight">Join a circle</h1>
        <JoinBody token={token} errorMessage={errorMessage} />
      </main>
    </div>
  );
}

async function JoinBody({
  token,
  errorMessage,
}: {
  token: string;
  errorMessage: string | null;
}) {
  if (!isInviteToken(token)) {
    return (
      <p className="mt-4 text-base leading-7 text-foreground/80">
        This invite link isn&apos;t valid.
      </p>
    );
  }

  const session = await getSession();
  if (!session) {
    const next = joinPath(token);
    return (
      <>
        <p className="mt-4 text-base leading-7 text-foreground/80">
          Sign in to see who invited you, then confirm. The link does not join
          you on its own.
        </p>
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="mt-8 inline-flex h-12 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-ink"
        >
          Sign in
        </Link>
      </>
    );
  }

  const { data, error } = await session.supabase.rpc("preview_invite", {
    raw_token: token,
  });
  const preview = data?.[0];

  if (error || !preview) {
    return (
      <p className="mt-4 text-base leading-7 text-foreground/80" role="alert">
        {inviteStateMessage("missing")}
      </p>
    );
  }

  const stateMessage = inviteStateMessage(preview.invite_state);
  const title =
    preview.circle_type && isCircleType(preview.circle_type)
      ? circleTitle(preview.circle_name, preview.circle_type)
      : "This circle";

  if (preview.invite_state === "already_member" && preview.circle_id) {
    return (
      <>
        <p className="mt-4 text-base leading-7 text-foreground/80">
          You&apos;re already in {title}.
        </p>
        <Link
          href={`/circles/${preview.circle_id}`}
          className="mt-8 inline-flex h-12 items-center justify-center self-start rounded-full bg-accent px-6 text-sm font-medium text-accent-ink"
        >
          Open the circle
        </Link>
      </>
    );
  }

  if (preview.invite_state !== "ready") {
    return (
      <p className="mt-4 text-base leading-7 text-foreground/80" role="alert">
        {stateMessage ?? inviteStateMessage("missing")}
      </p>
    );
  }

  return (
    <>
      <p className="mt-4 text-base leading-7 text-foreground/80">
        Join {title}? You&apos;ll see each other&apos;s name, photo, and
        timezone. Email stays private.
      </p>
      {errorMessage ? (
        <p className="mt-4 text-sm leading-6" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <form action={redeemInvite} className="mt-8">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-accent-ink"
        >
          Join circle
        </button>
      </form>
    </>
  );
}
