import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PhotoBooth } from "@/components/photo-booth";
import { SignedInHeader } from "@/components/signed-in-header";
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
        <PhotoBooth circleId={circle.id} circleTitle={circle.title} />
      </main>
    </div>
  );
}
