import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InstallHint } from "@/components/install-hint";
import { PushPanel } from "@/components/push-panel";
import { getSession, type Session } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const profile = await loadProfile(session);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="text-sm font-medium text-pine underline decoration-pine/40"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col gap-10 py-16">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">
            {profile?.displayName
              ? `Hello, ${profile.displayName}`
              : "You're in"}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
            This is a placeholder home. Circles, letters, and the bucket list
            come in later weeks. For now, you can subscribe this device and send
            yourself a test notification.
          </p>
          {profile ? (
            <p className="mt-4 text-sm text-foreground/70">
              Timezone: {profile.timezone}
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-foreground/70">
              You&apos;re signed in, but there is no profile row yet. Apply the
              migration in <code>supabase/migrations</code> so signup creates
              one. Your email stays in Supabase Auth — it is not stored on the
              profile.
            </p>
          )}
        </div>
        <InstallHint />
        <PushPanel />
      </main>
    </div>
  );
}

async function loadProfile(
  session: Session,
): Promise<{ displayName: string; timezone: string } | null> {
  const { data, error } = await session.supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", session.userId)
    .maybeSingle();

  if (error || !data) return null;
  return { displayName: data.display_name, timezone: data.timezone };
}
