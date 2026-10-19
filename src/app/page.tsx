import Link from "next/link";
import { redirect } from "next/navigation";

import { InstallHint } from "@/components/install-hint";
import { getUserId } from "@/lib/supabase/session";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[] }>;
}) {
  // The installed app opens here on some phones. A signed-in person should
  // land in the app, not on the sign-in pitch.
  const userId = await getUserId();
  if (userId) redirect("/home");
  const params = await searchParams;
  const deleted = params.deleted === "1";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <header>
        <p className="font-serif text-xl tracking-tight">Hsummer</p>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <p className="text-sm font-medium tracking-wide text-pine uppercase">
          For people far apart
        </p>
        <h1 className="mt-4 font-serif text-6xl tracking-tight sm:text-7xl">
          Hsummer
        </h1>
        <p className="mt-4 max-w-xl text-xl leading-8">
          Made for couples, built for groups, friends, and families.
        </p>
        <p className="mt-6 max-w-xl text-base leading-7 text-foreground/80">
          A private shared space for a couple, a few friends, or a family. What
          you send stays between the people in that Circle.
        </p>
        {deleted ? (
          <p className="mt-6 max-w-xl text-sm leading-6" role="status">
            Your account was deleted.
          </p>
        ) : null}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Link
            href="/sign-in"
            className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-accent-ink"
          >
            Sign in
          </Link>
          <form action="/api/demo/enter" method="post">
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-full border border-line bg-card px-6 text-sm font-medium"
            >
              Try demo
            </button>
          </form>
          <p className="text-sm text-foreground/70">
            Google or an email link. No password. The demo is a fictional
            couple.
          </p>
        </div>
        <div className="mt-10 max-w-xl">
          <InstallHint />
        </div>
      </main>
    </div>
  );
}
