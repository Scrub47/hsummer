import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BoothModes } from "@/components/booth-modes";
import { DemoBanner } from "@/components/demo-banner";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadPassBooth, loadTogetherBooth } from "@/lib/booth/load";
import { circleNeedsPicker } from "@/lib/circles/fields";
import type { PassBlocked } from "@/lib/booth/fields";
import { loadCircle } from "@/lib/circles/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Photo booth",
};

export default async function BoothPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/sign-in?next=/circles/${id}/booth`);

  const circle = await loadCircle(session, id);
  if (!circle || circle.status === "archived") notFound();

  const others = circle.members.filter(
    (member) => member.userId !== session.userId,
  );
  const canStart = circle.status === "active" && others.length >= 1;
  const blocked: PassBlocked | null = canStart
    ? null
    : circle.status === "pending"
      ? "pending"
      : "alone";
  const names = new Map(
    circle.members.map((member) => [member.userId, member.displayName]),
  );
  const self = circle.members.find(
    (member) => member.userId === session.userId,
  );
  const pass = await loadPassBooth(
    session,
    circle.id,
    names,
    self?.timezone ?? "UTC",
  );
  const lobby = await loadTogetherBooth(session, circle.id, names);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader
        current="circles"
        backFallback={`/circles/${circle.id}`}
        gear
      />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <p>
          <Link
            href={`/circles/${circle.id}`}
            className="text-sm font-medium text-pine"
          >
            Back to {circle.title}
          </Link>
        </p>
        {circle.isDemo ? (
          <>
            <DemoBanner />
            <p className="max-w-xl text-sm leading-6">
              The camera stays off in the demo. The sample strip is on the
              memory wall.
            </p>
            <Link
              href={`/circles/${circle.id}#memory-heading`}
              className="btn w-fit"
            >
              See the sample strip
            </Link>
          </>
        ) : (
          <BoothModes
            circleId={circle.id}
            circleTitle={circle.title}
            canStart={canStart}
            blocked={blocked}
            people={others.map((member) => ({
              userId: member.userId,
              displayName: member.displayName,
            }))}
            needsPicker={circleNeedsPicker(others.length)}
            selfId={session.userId}
            turns={pass.ok ? pass.turns : []}
            lobby={lobby}
            unavailable={!pass.ok}
          />
        )}
      </main>
    </div>
  );
}
