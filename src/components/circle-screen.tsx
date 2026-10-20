import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { BucketList } from "@/components/bucket-list";
import { CircleManage } from "@/components/circle-manage";
import { CircleMoods } from "@/components/circle-moods";
import { CircleTabs } from "@/components/circle-tabs";
import { EmptyState } from "@/components/empty-state";
import { InfoTip } from "@/components/info-tip";
import { Letters } from "@/components/letters";
import { MemoryWall } from "@/components/memory-wall";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { RecentPings } from "@/components/recent-pings";
import { SignedInHeader } from "@/components/signed-in-header";
import { StillUs } from "@/components/still-us";
import { CircleMute } from "@/components/circle-mute";
import { ThinkingOfYou } from "@/components/thinking-of-you";
import { circleStatusLabel } from "@/lib/circles/status";
import { circleNeedsPicker } from "@/lib/circles/fields";
import { loadPassBooth } from "@/lib/booth/load";
import { loadBucketItems } from "@/lib/bucket/load";
import { prepareCircle } from "@/lib/circles/prepare";
import { loadCircle } from "@/lib/circles/load";
import { loadStillUs } from "@/lib/countdowns/load";
import { pushOrigin } from "@/lib/auth/request-origin";
import { loadLetters } from "@/lib/letters/load";
import { loadPinnedLetterIds } from "@/lib/letters/pins";
import { loadResponses } from "@/lib/responses/load";
import { calendarDate } from "@/lib/memories/fields";
import { loadMemories } from "@/lib/memories/load";
import { loadCurrentMoods } from "@/lib/moods/load";
import { loadRecentPings } from "@/lib/pings/load";
import { AVATAR_SIGNED_URL_SECONDS } from "@/lib/profile/fields";
import type { Session } from "@/lib/supabase/session";

export async function CircleScreen({
  session,
  circleId,
}: {
  session: Session;
  circleId: string;
}) {
  const circle = await loadCircle(session, circleId);
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
  const [
    pings,
    bucket,
    moods,
    memories,
    letters,
    stillUs,
    pass,
    pinnedIds,
    responses,
  ] = await Promise.all([
    gestures
      ? loadRecentPings(session, circle.id, names, zone)
      : Promise.resolve([]),
    loadBucketItems(session, circle.id, names),
    loadCurrentMoods(session, circle.id, zone),
    loadMemories(session, circle.id, names),
    loadLetters(session, circle.id, names),
    loadStillUs(session, circle.id, zone),
    loadPassBooth(session, circle.id, names, zone),
    loadPinnedLetterIds(session, circle.id),
    loadResponses(session, circle.id, names),
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
      <SignedInHeader current="circles" backFallback="/circles" gear />
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
          initial="home"
          home={
            <>
              {circle.circleType !== "couple" && !circle.isDemo ? (
                <CircleMute
                  circleId={circle.id}
                  mutedUntil={circle.mutedUntil}
                />
              ) : null}
              <CircleManage
                circleId={circle.id}
                circleType={circle.circleType}
                status={circle.status}
                invite={circle.invite}
                inviteClosed={circle.inviteClosed}
                demo={circle.isDemo}
                name={circle.name}
                selfId={session.userId}
                members={circle.members}
              />
            </>
          }
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
                  readOnly={circle.isDemo}
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
                canShare={gestures && !circle.isDemo}
                locked={circle.isDemo}
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
                canWrite={gestures && !circle.isDemo}
                locked={circle.isDemo}
                people={others.map((member) => ({
                  userId: member.userId,
                  displayName: member.displayName,
                  timezone: member.timezone,
                }))}
                pending={circle.status === "pending"}
                letters={letters.letters}
                categories={letters.categories}
                pinnedIds={pinnedIds}
                responses={Object.fromEntries(responses)}
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
                locked={circle.isDemo}
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
                locked={circle.isDemo}
              />
            ) : (
              <p className="text-sm text-muted">
                Still Us isn&apos;t in the database yet.
              </p>
            ),
            booth: circle.isDemo ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-bold">Photo booth</h2>
                <p className="text-sm leading-6 text-muted">
                  The camera stays off in the demo. The sample strip is a
                  drawing, and it is already on the memory wall.
                </p>
                <a href="#memory-heading" className="btn w-fit">
                  See the sample strip
                </a>
              </section>
            ) : (
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
                responses={Object.fromEntries(responses)}
                locked={circle.isDemo}
              />
            ) : (
              <p className="text-sm text-muted">
                The memory wall isn&apos;t in the database yet.
              </p>
            ),
          }}
        />
      </main>
    </div>
  );
}
