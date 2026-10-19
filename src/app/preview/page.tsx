import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BucketList } from "@/components/bucket-list";
import { CircleManage } from "@/components/circle-manage";
import { CircleMoods } from "@/components/circle-moods";
import { CircleTabs } from "@/components/circle-tabs";
import { HomeHero } from "@/components/home-hero";
import { HomeShortcuts } from "@/components/home-shortcuts";
import { LetterEnvelope } from "@/components/letter-envelope";
import { Letters } from "@/components/letters";
import { MemoryWall } from "@/components/memory-wall";
import { ProfileForm } from "@/components/profile-form";
import { PushPanel } from "@/components/push-panel";
import { RecentPings } from "@/components/recent-pings";
import { SignedInHeader } from "@/components/signed-in-header";
import { StillUs } from "@/components/still-us";
import { ThinkingOfYou } from "@/components/thinking-of-you";
import type { LetterCard } from "@/lib/letters/view";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

const circleId = "11111111-1111-4111-8111-111111111111";

/**
 * Fixture screens for the redesign shots. The production build 404s.
 * Nothing here reads or writes a circle.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    screen?: string;
    tab?: string;
    scene?: string;
    motion?: string;
    at?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const screen = params.screen ?? "home";
  const nested = screen === "circle" || screen === "empty";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader
        current={
          screen === "profile" || screen === "settings"
            ? "profile"
            : nested
              ? "circles"
              : "home"
        }
        gear={screen !== "settings"}
        backFallback={
          screen === "settings" ? "/profile" : nested ? "/circles" : undefined
        }
      />
      <main className="flex flex-1 flex-col gap-5 py-6">
        {screen === "profile" ? <ProfilePreview /> : null}
        {screen === "home" ? <HomePreview filled={false} /> : null}
        {screen === "filled" ? <HomePreview filled /> : null}
        {screen === "settings" ? <SettingsPreview /> : null}
        {screen === "circle" ? (
          <CirclePreview tab={params.tab ?? "ping"} empty={false} />
        ) : null}
        {screen === "empty" ? <CirclePreview tab="letters" empty /> : null}
        {screen === "envelope" ? (
          <LetterEnvelope
            scene={params.scene === "open" ? "open" : "send"}
            reduced={params.motion === "reduced"}
            holdAt={
              params.at != null && Number.isFinite(Number(params.at))
                ? Number(params.at)
                : null
            }
          />
        ) : null}
      </main>
    </div>
  );
}

function SettingsPreview() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <PushPanel />
    </>
  );
}

function HomePreview({ filled }: { filled: boolean }) {
  return (
    <>
      <HomeHero
        greeting="Hi, Isaac"
        selfZone="America/Los_Angeles"
        partner={
          filled
            ? {
                name: "Summer",
                timeZone: "America/New_York",
                avatarUrl: null,
                moodEmoji: "🥰",
                moodLabel: "Loved",
              }
            : null
        }
        people={
          filled
            ? [
                {
                  name: "Summer",
                  timeZone: "America/New_York",
                  avatarUrl: null,
                  moodEmoji: "🥰",
                  moodLabel: "Loved",
                },
              ]
            : []
        }
        countdown={
          filled ? { label: "next visit", daysText: "118 days" } : null
        }
        circleHref="/circles"
        circleId={filled ? circleId : null}
        canPing={filled}
        pingName="Summer"
        pingPeople={[{ userId: "summer", displayName: "Summer" }]}
        pending={false}
      />
      <HomeShortcuts circleId={filled ? circleId : null} />
    </>
  );
}

function ProfilePreview() {
  return (
    <>
      <h1 className="text-2xl font-bold">Profile</h1>
      <ProfileForm
        displayName="Isaac Hsu"
        timezone="America/Los_Angeles"
        avatarUrl={null}
        hasAvatar={false}
      />
    </>
  );
}

function CirclePreview({ tab, empty }: { tab: string; empty: boolean }) {
  const letter: LetterCard = {
    id: "letter-1",
    fromUserId: "isaac",
    toUserId: "summer",
    category: "need-motivation",
    categoryLabel: "Need motivation",
    title: "For the ferry",
    body: "The ferry is still ours.",
    design: "kawaii",
    status: "delivered",
    scheduledFor: null,
    deliveredAt: "2026-10-01T00:00:00.000Z",
    openedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    mine: true,
    sealed: false,
    dearName: "Dear Summer",
    fromName: "Isaac",
  };

  return (
    <>
      <p className="text-sm font-bold text-pine">Together</p>
      <h1 className="text-2xl font-bold">Me & Summer</h1>
      <CircleTabs
        initial={tab === "home" ? "home" : tab}
        home={
          tab === "home" ? (
            <CircleManage
              circleId={circleId}
              circleType="couple"
              status="active"
              invite={{
                id: "22222222-2222-4222-8222-222222222222",
                expiresAt: "2026-10-26T19:00:00.000Z",
                maxUses: 1,
                useCount: 0,
                revokedAt: null,
              }}
              inviteClosed={false}
              demo={false}
              name="Me & Summer"
              selfId="isaac"
              members={[
                {
                  userId: "isaac",
                  displayName: "Isaac",
                  timezone: "America/Los_Angeles",
                  avatarUrl: null,
                },
                {
                  userId: "summer",
                  displayName: "Summer",
                  timezone: "America/New_York",
                  avatarUrl: null,
                },
              ]}
            />
          ) : null
        }
        panels={{
          ping: (
            <>
              <ThinkingOfYou
                circleId={circleId}
                partnerName="Summer"
                people={[]}
              />
              <RecentPings pings={[]} selfId="isaac" />
            </>
          ),
          moods: (
            <CircleMoods
              circleId={circleId}
              selfId="isaac"
              partnerName="Summer"
              waiting={false}
              canShare
              members={[
                {
                  userId: "summer",
                  displayName: "Summer",
                  avatarUrl: null,
                },
                {
                  userId: "isaac",
                  displayName: "Isaac",
                  avatarUrl: null,
                },
              ]}
              moods={[
                {
                  userId: "summer",
                  emoji: "🥰",
                  label: "Loved",
                  when: "2h ago",
                },
              ]}
            />
          ),
          letters: (
            <Letters
              circleId={circleId}
              partnerName="Summer"
              partnerTimeZone="America/New_York"
              canWrite
              pending={false}
              letters={empty ? [] : [letter]}
              categories={[]}
            />
          ),
          bucket: (
            <BucketList
              circleId={circleId}
              pending={false}
              items={
                empty
                  ? []
                  : [
                      {
                        id: "bucket-1",
                        title: "Ferry to Bainbridge",
                        category: "date-idea",
                        status: "idea",
                        plannedDate: null,
                        completedAt: null,
                        notes: null,
                        link: null,
                        createdBy: "isaac",
                        author: "Isaac",
                        createdAt: "2026-10-01T00:00:00.000Z",
                        updatedAt: "2026-10-01T00:00:00.000Z",
                      },
                    ]
              }
            />
          ),
          still: (
            <StillUs
              circleId={circleId}
              circleType="couple"
              countdowns={
                empty
                  ? []
                  : [
                      {
                        id: "count-1",
                        label: "Next visit",
                        targetDate: "2027-02-14",
                        days: 118,
                        daysText: "118 days",
                        targetLabel: "Feb 14, 2027",
                      },
                    ]
              }
              checkpoints={[]}
            />
          ),
          booth: (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold">Photo booth</h2>
              <p className="text-sm text-muted">
                A strip on this phone, or pass one back and forth.
              </p>
              <a className="btn w-fit" href={`/circles/${circleId}/booth`}>
                Open the photo booth
              </a>
            </section>
          ),
          memory: (
            <MemoryWall
              circleId={circleId}
              today="2026-10-19"
              usedBytes={0}
              pending={false}
              people={[{ userId: "summer", displayName: "Summer" }]}
              memories={
                empty
                  ? []
                  : [
                      {
                        id: "memory-1",
                        kind: "note",
                        body: "Ferry to Bainbridge",
                        photoUrl: null,
                        photoPath: null,
                        tags: ["summer"],
                        visibility: "circle",
                        viewerNames: [],
                        occurredOn: "2026-10-01",
                        createdAt: "2026-10-01T00:00:00.000Z",
                        author: "Isaac",
                        mine: true,
                        letterId: null,
                        booth: null,
                      },
                      {
                        id: "memory-2",
                        kind: "photo",
                        body: "Kitchen light",
                        photoUrl: "/brand/logo-512-v2.png",
                        photoPath: null,
                        tags: [],
                        visibility: "circle",
                        viewerNames: [],
                        occurredOn: "2026-10-02",
                        createdAt: "2026-10-02T00:00:00.000Z",
                        author: "Summer",
                        mine: false,
                        letterId: null,
                        booth: null,
                      },
                    ]
              }
            />
          ),
        }}
      />
    </>
  );
}
