import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CircleCreateForm } from "@/components/circle-create-form";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadCircles } from "@/lib/circles/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Circles",
};

export default async function CirclesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const loaded = await loadCircles(session);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="circles" />
      <main className="flex flex-1 flex-col gap-10 py-16">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">Circles</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
            A circle is the private space you share. Start a couple circle and
            send the invite link. It works once.
          </p>
        </div>

        {loaded.ok && loaded.circles.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {loaded.circles.map((circle) => (
              <li key={circle.id}>
                <Link
                  href={`/circles/${circle.id}`}
                  className="flex items-center justify-between gap-4 rounded-3xl border border-line bg-card px-5 py-4"
                >
                  <span>
                    <span className="block font-medium">{circle.title}</span>
                    <span className="mt-1 block text-sm text-foreground/70">
                      {statusLabel(circle.status)}
                    </span>
                  </span>
                  <span className="text-sm text-pine">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {!loaded.ok ? (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            Circles aren&apos;t in the database yet. Apply{" "}
            <code>
              supabase/migrations/20261026120000_circles_and_invites.sql
            </code>{" "}
            in the Supabase SQL editor, then reload this page.
          </p>
        ) : (
          <CircleCreateForm />
        )}
      </main>
    </div>
  );
}

function statusLabel(status: "pending" | "active" | "archived"): string {
  if (status === "active") return "Active";
  if (status === "archived") return "Archived";
  return "Waiting for someone to join";
}
