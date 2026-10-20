import Link from "next/link";
import { redirect } from "next/navigation";

import { BearMark } from "@/components/bear-mark";
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
      <header className="flex items-center gap-2">
        <BearMark size={40} alt="" />
        <p className="font-hand text-2xl leading-none">Hsummer</p>
      </header>
      <main className="flex flex-1 flex-col justify-center py-8">
        <BearMark size={160} priority alt="" />
        <h1 className="mt-4 font-hand text-5xl">Hsummer</h1>
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
          <Link
            href="/demo"
            className="inline-flex h-12 items-center justify-center rounded-full border border-line bg-card px-6 text-sm font-medium"
          >
            Try the demo
          </Link>
          <p className="text-sm text-foreground/70">
            Google or an email link. No password. The demo is a fictional
            couple, and it does not need a Google account.
          </p>
        </div>
        <div className="mt-10 max-w-xl">
          <InstallHint />
        </div>
      </main>
    </div>
  );
}
