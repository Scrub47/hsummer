import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { LeaveCircleForm } from "@/components/leave-circle-form";
import { BucketList } from "@/components/bucket-list";
import { CircleMoods } from "@/components/circle-moods";
import { CircleTabs } from "@/components/circle-tabs";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { InvitePanel } from "@/components/invite-panel";
import { Letters } from "@/components/letters";
import { MemoryWall } from "@/components/memory-wall";
import { ProfileAvatar } from "@/components/profile-avatar";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { RecentPings } from "@/components/recent-pings";
import { RenameCircleForm } from "@/components/rename-circle-form";
import { SignedInHeader } from "@/components/signed-in-header";
import { StillUs } from "@/components/still-us";
import { CircleMute } from "@/components/circle-mute";
import { ThinkingOfYou } from "@/components/thinking-of-you";
import { circleStatusLabel } from "@/lib/circles/status";
import { friendlyZoneLabel } from "@/lib/time/zones";
import { circleNeedsPicker } from "@/lib/circles/fields";
import { loadPassBooth } from "@/lib/booth/load";
import { loadBucketItems } from "@/lib/bucket/load";
import { prepareCircle } from "@/lib/circles/prepare";
import { loadCircle } from "@/lib/circles/load";
import { loadStillUs } from "@/lib/countdowns/load";
import { pushOrigin } from "@/lib/auth/request-origin";
import { loadLetters } from "@/lib/letters/load";
import { calendarDate } from "@/lib/memories/fields";
import { loadMemories } from "@/lib/memories/load";
import { loadCurrentMoods } from "@/lib/moods/load";
import { loadRecentPings } from "@/lib/pings/load";
import { AVATAR_SIGNED_URL_SECONDS } from "@/lib/profile/fields";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Circle",
};

export default async function CirclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/circles");

  const { id } = await params;
  const circle = await loadCircle(session, id);
  if (!circle) notFound();

  const others = circle.members.filter(
    (member) => member.userId !== session.userId,
  );
  const partner = others.length === 1 ? others[0] : null;
  const gestures = circle.status === "active" && others.length >= 1;
  const needsPicker = circleNeedsPicker(others.length);
  const self = circle.members.find(
    (member) => member.userId === session.userId,
  );
  const names = new Map(
    circle.members.map((member) => [member.userId, member.displayName]),
  );
  const zone = self?.timezone ?? "UTC";
  if (circle.status !== "archived") {
    await prepareCircle(session, circle.id, pushOrigin(await headers()));
  }
  const [pings, bucket, moods, memories, letters, stillUs, pass] =
    await Promise.all([
      gestures
        ? loadRecentPings(session, circle.id, names, zone)
        : Promise.resolve([]),
      loadBucketItems(session, circle.id, names),
      loadCurrentMoods(session, circle.id, zone),
      loadMemories(session, circle.id, names),
      loadLetters(session, circle.id, names),
      loadStillUs(session, circle.id, zone),
      loadPassBooth(session, circle.id, names, zone),
    ]);
  const yourTurn =
    pass.ok &&
    pass.turns.some((turn) => turn.waitingOnYou && turn.status === "open");
  const waitingOnPartner =
    pass.ok &&
    pass.turns.some(
      (turn) =>
        turn.status === "open" && turn.startedByMe && !turn.waitingOnYou,
    );
  const waitingLabel = pass.ok
    ? pass.turns.find(
        (turn) =>
          turn.status === "open" && turn.startedByMe && !turn.waitingOnYou,
      )?.stillWaiting
    : null;

  const memoryPhotos =
    memories.ok && memories.wall.memories.some((memory) => memory.photoUrl);
  const avatarLinks = circle.members.some((member) => member.avatarUrl);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      {memoryPhotos ? null : (
        <RefreshSignedUrls
          enabled={avatarLinks}
          seconds={AVATAR_SIGNED_URL_SECONDS}
        />
      )}
      <SignedInHeader current="circles" />
      <main className="flex flex-1 flex-col gap-6 py-16">
        <div>
          <p className="text-sm font-bold text-pine">
            {circleStatusLabel(circle.status)}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {circle.title}
            </h1>
            <InfoTip label="About this circle">
              {circle.status === "pending"
                ? "Share the invite. Moods, Still Us, the photo booth, the memory wall, and the bucket list work now. Letters and Thinking of You open once you're both here."
                : "Moods, letters, Still Us, the photo booth, memories, and the bucket list live in the tabs."}
            </InfoTip>
          </div>
          {circle.isDemo ? (
            <div className="mt-4">
              <DemoBanner />
            </div>
          ) : null}
          {circle.isDemo || others.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {circle.isDemo
                ? "Look around. Nothing you type is saved."
                : circle.status === "pending"
                  ? "Waiting for someone to join."
                  : "You're the only one here right now."}
            </p>
          ) : null}
        </div>

        <CircleTabs
          initial={gestures ? "ping" : "moods"}
          panels={{
            ping: gestures ? (
              <>
                <ThinkingOfYou
                  circleId={circle.id}
                  partnerName={
                    partner?.displayName ??
                    (needsPicker ? "someone here" : "your partner")
                  }
                  people={others.map((member) => ({
                    userId: member.userId,
                    displayName: member.displayName,
                  }))}
                />
                <RecentPings pings={pings} selfId={session.userId} />
              </>
            ) : (
              <EmptyState
                title="No pings yet"
                detail="Thinking of You opens once you're both here."
              />
            ),
            moods: moods.ok ? (
              <CircleMoods
                circleId={circle.id}
                selfId={session.userId}
                partnerName={partner?.displayName ?? null}
                waiting={circle.status === "pending"}
                canShare={gestures}
                members={circle.members.map((member) => ({
                  userId: member.userId,
                  displayName: member.displayName,
                  avatarUrl: member.avatarUrl,
                }))}
                moods={moods.moods}
              />
            ) : (
              <p className="text-sm text-muted">
                Moods aren&apos;t in the database yet.
              </p>
            ),
            letters: letters.ok ? (
              <Letters
                circleId={circle.id}
                partnerName={partner?.displayName ?? null}
                partnerTimeZone={partner?.timezone ?? zone}
                canWrite={gestures}
                people={others.map((member) => ({
                  userId: member.userId,
                  displayName: member.displayName,
                  timezone: member.timezone,
                }))}
                pending={circle.status === "pending"}
                letters={letters.letters}
                categories={letters.categories}
              />
            ) : (
              <p className="text-sm text-muted">
                Letters aren&apos;t in the database yet.
              </p>
            ),
            bucket: bucket.ok ? (
              <BucketList
                circleId={circle.id}
                items={bucket.items}
                pending={circle.status === "pending"}
              />
            ) : (
              <p className="text-sm text-muted">
                The bucket list isn&apos;t in the database yet.
              </p>
            ),
            still: stillUs.ok ? (
              <StillUs
                circleId={circle.id}
                circleType={circle.circleType}
                countdowns={stillUs.countdowns}
                checkpoints={stillUs.checkpoints}
              />
            ) : (
              <p className="text-sm text-muted">
                Still Us isn&apos;t in the database yet.
              </p>
            ),
            booth: (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-bold">Photo booth</h2>
                <p className="text-sm text-muted">
                  A strip on this phone, or pass one back and forth.
                </p>
                {yourTurn ? (
                  <p className="text-sm font-bold text-pine">
                    It&apos;s your turn in the photo booth.
                  </p>
                ) : null}
                {waitingOnPartner && waitingLabel ? (
                  <p className="text-sm text-muted">
                    A booth is waiting on {waitingLabel}.
                  </p>
                ) : null}
                <Link
                  href={`/circles/${circle.id}/booth`}
                  className="btn w-fit"
                >
                  {yourTurn ? "Take your frames" : "Open the photo booth"}
                </Link>
              </section>
            ),
            memory: memories.ok ? (
              <MemoryWall
                circleId={circle.id}
                memories={memories.wall.memories}
                people={others.map((member) => ({
                  userId: member.userId,
                  displayName: member.displayName,
                }))}
                today={calendarDate(zone)}
                usedBytes={memories.wall.usedBytes}
                pending={circle.status === "pending"}
              />
            ) : (
              <p className="text-sm text-muted">
                The memory wall isn&apos;t in the database yet.
              </p>
            ),
          }}
        />

        {circle.circleType !== "couple" && !circle.isDemo ? (
          <CircleMute circleId={circle.id} mutedUntil={circle.mutedUntil} />
        ) : null}

        <InvitePanel
          circleId={circle.id}
          circleType={circle.circleType}
          status={circle.status}
          invite={circle.invite}
          closed={circle.inviteClosed}
          demo={circle.isDemo}
        />

        <section>
          <h2 className="font-serif text-2xl tracking-tight">People</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {circle.members.map((member) => (
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
                    {member.userId === session.userId ? " (you)" : ""}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {friendlyZoneLabel(member.timezone)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {circle.isDemo ? null : (
          <RenameCircleForm circleId={circle.id} name={circle.name} />
        )}
        {circle.isDemo ? null : <LeaveCircleForm circleId={circle.id} />}
      </main>
    </div>
  );
}
