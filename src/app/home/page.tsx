import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileAvatar } from "@/components/profile-avatar";
import { PushPanel } from "@/components/push-panel";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadCircle, loadCircles } from "@/lib/circles/load";
import { loadCurrentMoods } from "@/lib/moods/load";
import { AVATAR_SIGNED_URL_SECONDS } from "@/lib/profile/fields";
import { loadOwnProfile } from "@/lib/profile/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [profile, circles] = await Promise.all([
    loadOwnProfile(session),
    loadCircles(session),
  ]);
  const pending = circles.circles.filter(
    (circle) => circle.status === "pending",
  );
  const activeCouple = circles.circles.find(
    (circle) => circle.status === "active" && circle.circleType === "couple",
  );
  const homeMoods = activeCouple
    ? await Promise.all([
        loadCircle(session, activeCouple.id),
        loadCurrentMoods(session, activeCouple.id, profile?.timezone ?? "UTC"),
      ])
    : null;
  const moodCircle = homeMoods?.[0] ?? null;
  const moodRows = homeMoods?.[1].ok ? homeMoods[1].moods : null;

  const avatarLinks =
    Boolean(profile?.avatarUrl) ||
    Boolean(moodCircle?.members.some((member) => member.avatarUrl));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <RefreshSignedUrls
        enabled={avatarLinks}
        seconds={AVATAR_SIGNED_URL_SECONDS}
      />
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
                ? "Your circle is active. Open it for moods, the memory wall, the bucket list, or Thinking of You."
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
                  ? "Open your circle"
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
        {moodCircle && moodRows ? (
          <section aria-labelledby="home-mood-heading">
            <h2
              id="home-mood-heading"
              className="font-serif text-3xl tracking-tight"
            >
              Moods
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {moodCircle.members.map((member) => {
                const mood = moodRows.find(
                  (row) => row.userId === member.userId,
                );
                const you = member.userId === session.userId;
                return (
                  <li
                    key={member.userId}
                    className="flex items-center gap-4 rounded-3xl border border-line bg-card px-4 py-3"
                  >
                    <ProfileAvatar
                      name={member.displayName}
                      url={member.avatarUrl}
                      alt=""
                      className="h-12 w-12 text-lg"
                    />
                    <span>
                      <span className="block font-medium">
                        {member.displayName}
                        {you ? " (you)" : ""}
                      </span>
                      <span className="mt-1 block text-sm text-foreground/80">
                        {mood ? (
                          <>
                            <span aria-hidden="true">{mood.emoji} </span>
                            {mood.label}
                          </>
                        ) : (
                          "No mood yet"
                        )}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <PushPanel />
      </main>
    </div>
  );
}
