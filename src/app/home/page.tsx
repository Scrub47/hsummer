import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { HomeHero, type HeroPerson } from "@/components/home-hero";
import { HomeShortcuts } from "@/components/home-shortcuts";
import { Onboarding } from "@/components/onboarding";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { SignedInHeader } from "@/components/signed-in-header";
import { prepareCircle } from "@/lib/circles/prepare";
import { loadCircle, loadCircles } from "@/lib/circles/load";
import { loadStillUs } from "@/lib/countdowns/load";
import { pushOrigin } from "@/lib/auth/request-origin";
import { loadCurrentMoods } from "@/lib/moods/load";
import { firstName } from "@/lib/profile/first-name";
import { AVATAR_SIGNED_URL_SECONDS } from "@/lib/profile/fields";
import { loadAccountFlags } from "@/lib/account/load";
import { loadOwnProfile } from "@/lib/profile/load";
import { releaseDuePings } from "@/lib/settings/release";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [profile, circles, account] = await Promise.all([
    loadOwnProfile(session),
    loadCircles(session),
    loadAccountFlags(session),
  ]);
  const origin = pushOrigin(await headers());
  await releaseDuePings(origin);
  await Promise.all(
    circles.circles
      .filter((circle) => circle.status !== "archived")
      .map((circle) => prepareCircle(session, circle.id, origin)),
  );
  const pending = circles.circles.filter(
    (circle) => circle.status === "pending",
  );
  const activeCouple = circles.circles.find(
    (circle) => circle.status === "active" && circle.circleType === "couple",
  );
  const activeCircle = circles.circles.find(
    (circle) => circle.status === "active",
  );
  const focus = activeCouple ?? activeCircle ?? pending[0] ?? null;
  const focusDetail = focus ? await loadCircle(session, focus.id) : null;
  const zone = profile?.timezone ?? "UTC";
  const [moodResult, still] = focusDetail
    ? await Promise.all([
        loadCurrentMoods(session, focusDetail.id, zone),
        loadStillUs(session, focusDetail.id, zone),
      ])
    : [null, null];

  const others = focusDetail
    ? focusDetail.members.filter((member) => member.userId !== session.userId)
    : [];
  const partner = others.length === 1 ? others[0] : null;
  const canPing = Boolean(
    focusDetail && focusDetail.status === "active" && others.length >= 1,
  );

  function person(member: {
    displayName: string;
    timezone: string;
    avatarUrl: string | null;
    userId: string;
  }): HeroPerson {
    const mood = moodResult?.ok
      ? moodResult.moods.find((row) => row.userId === member.userId)
      : undefined;
    return {
      name: member.displayName,
      timeZone: member.timezone,
      avatarUrl: member.avatarUrl,
      moodEmoji: mood?.emoji ?? null,
      moodLabel: mood?.label ?? null,
    };
  }

  const people = others.map(person);
  const countdown = still?.ok
    ? (still.countdowns.find((item) => item.daysText && item.label) ?? null)
    : null;
  const circleHref = focusDetail ? `/circles/${focusDetail.id}` : "/circles";
  const greeting = profile?.displayName
    ? `Hi, ${firstName(profile.displayName)}`
    : "Hi";

  const avatarLinks =
    Boolean(profile?.avatarUrl) || people.some((person) => person.avatarUrl);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <RefreshSignedUrls
        enabled={avatarLinks}
        seconds={AVATAR_SIGNED_URL_SECONDS}
      />
      <SignedInHeader current="home" gear />
      <main className="flex flex-1 flex-col gap-5 py-16">
        {account.isDemo ? <DemoBanner /> : null}
        <Onboarding />
        <HomeHero
          greeting={greeting}
          selfZone={profile?.timezone ?? null}
          partner={partner ? person(partner) : null}
          people={people}
          countdown={
            countdown?.daysText
              ? { label: countdown.label, daysText: countdown.daysText }
              : null
          }
          circleHref={circleHref}
          circleId={focusDetail?.id ?? null}
          canPing={canPing}
          pingName={partner?.displayName ?? "your person"}
          pingPeople={others.map((member) => ({
            userId: member.userId,
            displayName: member.displayName,
          }))}
          pending={pending.length > 0 && !canPing}
          pingLocked={account.isDemo}
        />
        <HomeShortcuts circleId={focusDetail?.id ?? null} />
      </main>
    </div>
  );
}
