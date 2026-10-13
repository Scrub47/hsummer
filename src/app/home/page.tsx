import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileAvatar } from "@/components/profile-avatar";
import { PushPanel } from "@/components/push-panel";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadCircles } from "@/lib/circles/load";
import { loadOwnProfile } from "@/lib/profile/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const profile = await loadOwnProfile(session);
  const circles = await loadCircles(session);
  const pending = circles.circles.filter(
    (circle) => circle.status === "pending",
  );
  const activeCouple = circles.circles.find(
    (circle) => circle.status === "active" && circle.circleType === "couple",
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="home" />
      <main className="flex flex-1 flex-col gap-10 py-16">
        <div>
          <div className="flex items-center gap-5">
            {profile ? (
              <ProfileAvatar
                name={profile.displayName}
                url={profile.avatarUrl}
                alt=""
                className="h-16 w-16 text-xl"
              />
            ) : null}
            <h1 className="font-serif text-5xl tracking-tight">
              {profile?.displayName
                ? `Hello, ${profile.displayName}`
                : "You're in"}
            </h1>
          </div>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
            {pending.length > 0
              ? "A circle is waiting for one more person. Share the invite link. Thinking of You stays closed until you both are here."
              : activeCouple
                ? "Your circle is active. Open it and tap Thinking of You."
                : "Create a circle and send one invite link. Thinking of You starts once you're both here."}
          </p>
          <p className="mt-4">
            <Link
              href={
                pending[0]
                  ? `/circles/${pending[0].id}`
                  : activeCouple
                    ? `/circles/${activeCouple.id}`
                    : circles.circles[0]
                      ? `/circles/${circles.circles[0].id}`
                      : "/circles"
              }
              className="text-sm font-medium text-pine underline decoration-pine/40"
            >
              {pending.length > 0
                ? "Share the invite"
                : activeCouple
                  ? "Thinking of You"
                  : "Circles"}
            </Link>
          </p>
          {profile ? (
            <p className="mt-4 text-sm text-foreground/70">
              Timezone: {profile.timezone}
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-foreground/70">
              You&apos;re signed in, but there is no profile row yet. Apply the
              migrations in <code>supabase/migrations</code> so signup creates
              one. Your email stays in Supabase Auth — it is not stored on the
              profile.
            </p>
          )}
        </div>
        <PushPanel />
      </main>
    </div>
  );
}
