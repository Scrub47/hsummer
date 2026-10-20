import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CircleCreateForm } from "@/components/circle-create-form";
import { DemoBanner } from "@/components/demo-banner";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadAccountFlags } from "@/lib/account/load";
import { loadCircles } from "@/lib/circles/load";
import { circleStatusLabel } from "@/lib/circles/status";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Circles",
};

export default async function CirclesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const [loaded, account] = await Promise.all([
    loadCircles(session),
    loadAccountFlags(session),
  ]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="circles" gear />
      <main className="flex flex-1 flex-col gap-10 py-16">
        {account.isDemo ? <DemoBanner /> : null}
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Circles</h1>
          <InfoTip label="About circles">
            A circle is the private space you share. A couple invite works once.
            A group invite can be used until it expires, or until you set a
            limit.
          </InfoTip>
        </div>

        {loaded.ok && loaded.circles.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {loaded.circles.map((circle) => (
              <li key={circle.id}>
                <Link
                  href={`/circles/${circle.id}`}
                  className="card flex min-h-14 items-center justify-between gap-4 px-4 py-3"
                >
                  <span>
                    <span className="block font-bold">{circle.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">
                      {circleStatusLabel(circle.status)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : loaded.ok ? (
          <EmptyState
            title="No circle yet"
            detail="Create one when you're ready."
          />
        ) : null}

        {!loaded.ok ? (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            Circles aren&apos;t in the database yet. Apply{" "}
            <code>
              supabase/migrations/20261026120000_circles_and_invites.sql
            </code>{" "}
            in the Supabase SQL editor, then reload this page.
          </p>
        ) : account.isDemo ? null : (
          <CircleCreateForm />
        )}
      </main>
    </div>
  );
}
