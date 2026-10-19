import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SignedInHeader } from "@/components/signed-in-header";
import { MemoryBook } from "@/components/memory-book";
import { loadCircle } from "@/lib/circles/load";
import { loadMemories } from "@/lib/memories/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Memory book",
};

export default async function MemoryBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const { id } = await params;
  const circle = await loadCircle(session, id);
  if (!circle) notFound();

  const names = new Map(
    circle.members.map((member) => [member.userId, member.displayName]),
  );
  const memories = await loadMemories(session, circle.id, names);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="circles" />
      <main className="flex flex-1 flex-col gap-5 py-6">
        <Link
          href={`/circles/${circle.id}`}
          className="text-sm font-bold text-pine"
        >
          Circle
        </Link>
        <h1 className="font-hand text-4xl">Memory book</h1>
        <p className="text-sm leading-6 text-muted">
          Pick the notes, photos, and strips to keep. Print them, or download a
          PDF.
        </p>
        {memories.ok ? (
          <MemoryBook circleId={circle.id} memories={memories.wall.memories} />
        ) : (
          <p className="text-sm text-muted">
            The memory wall isn&apos;t in the database yet.
          </p>
        )}
      </main>
    </div>
  );
}
