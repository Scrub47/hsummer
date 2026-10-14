import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BoothModes } from "@/components/booth-modes";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadPassBooth } from "@/lib/booth/load";
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
  const partner = others.length === 1 ? others[0] : null;
  const canStart =
    circle.circleType === "couple" &&
    circle.status === "active" &&
    partner !== undefined &&
    partner !== null;
  const blocked: PassBlocked | null = canStart
    ? null
    : circle.status === "pending"
      ? "pending"
      : circle.circleType !== "couple"
        ? "group"
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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="circles" />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <p>
          <Link
            href={`/circles/${circle.id}`}
            className="text-sm font-medium text-pine"
          >
            Back to {circle.title}
          </Link>
        </p>
        <BoothModes
          circleId={circle.id}
          circleTitle={circle.title}
          canStart={canStart}
          blocked={blocked}
          partnerName={partner?.displayName ?? null}
          turns={pass.ok ? pass.turns : []}
          unavailable={!pass.ok}
        />
      </main>
    </div>
  );
}
