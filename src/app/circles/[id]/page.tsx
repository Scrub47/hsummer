import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { LeaveCircleForm } from "@/components/leave-circle-form";
import { BucketList } from "@/components/bucket-list";
import { CircleMoods } from "@/components/circle-moods";
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
      <main className="flex flex-1 flex-col gap-10 py-16">
        <div>
          <p className="text-sm font-medium tracking-wide text-pine uppercase">
            {circle.status === "active"
              ? "Active"
              : circle.status === "archived"
                ? "Archived"
                : "Pending"}
          </p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight">
            {circle.title}
          </h1>
          {circle.isDemo ? (
            <div className="mt-4">
              <DemoBanner />
            </div>
          ) : null}
          {circle.isDemo ? (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              Look around Alex and Jordan&apos;s circle. Nothing you type is
              saved.
            </p>
          ) : circle.status === "pending" ? (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              This circle is waiting for one more person. Share the invite link.
              You can set a mood, set the Still Us date, open the photo booth,
              add to the memory wall, and start the bucket list now. Letters,
              Thinking of You, and Pass the booth stay closed until you both are
              here.
            </p>
          ) : (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              {others.length > 0
                ? `You're here with ${others.map((member) => member.displayName).join(", ")}.`
                : "You're the only one here right now."}{" "}
              {gestures
                ? needsPicker
                  ? "Set a mood, check Still Us, write a letter to one person, open the photo booth, add a memory, or tap Thinking of You — you choose who, or everyone."
                  : "Set a mood, check Still Us, write a letter, open the photo booth, add a memory, tap Thinking of You — it goes to your partner — or add to the bucket list."
                : "Set a mood, check Still Us, open the photo booth, add a memory, or add to the bucket list."}
            </p>
          )}
        </div>

        {moods.ok ? (
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
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            Moods aren&apos;t in the database yet. Apply{" "}
            <code>supabase/migrations/20261123120000_current_moods.sql</code> in
            the Supabase SQL editor, then reload this page.
          </p>
        )}

        {stillUs.ok ? (
          <StillUs
            circleId={circle.id}
            circleType={circle.circleType}
            countdowns={stillUs.countdowns}
            checkpoints={stillUs.checkpoints}
          />
        ) : (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            Still Us isn&apos;t in the database yet. Apply{" "}
            <code>supabase/migrations/20261228120000_still_us.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
        )}

        {letters.ok ? (
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
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            Letters aren&apos;t in the database yet. Apply{" "}
            <code>supabase/migrations/20261221120000_letters.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="font-serif text-3xl tracking-tight">Photo booth</h2>
          <p className="max-w-xl text-sm leading-6 text-foreground/80">
            Take a strip on this phone, or pass one back and forth. Nothing is
            saved while you shoot alone. A passed booth is saved for everyone in
            the circle once the last frame is in.
          </p>
          {yourTurn ? (
            <p className="text-sm font-medium text-pine">
              It&apos;s your turn in the photo booth.
            </p>
          ) : null}
          {waitingOnPartner && waitingLabel ? (
            <p className="text-sm text-foreground/70">
              A booth is waiting on {waitingLabel}.
            </p>
          ) : null}
          <Link
            href={`/circles/${circle.id}/booth`}
            className="inline-flex h-12 w-fit items-center rounded-full bg-accent px-5 text-base font-medium text-accent-ink"
          >
            {yourTurn ? "Take your frames" : "Open the photo booth"}
          </Link>
        </section>

        {memories.ok ? (
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
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            The memory wall isn&apos;t in the database yet. Apply{" "}
            <code>supabase/migrations/20261130120000_memories.sql</code> in the
            Supabase SQL editor, then reload this page.
          </p>
        )}

        {bucket.ok ? (
          <BucketList
            circleId={circle.id}
            items={bucket.items}
            pending={circle.status === "pending"}
          />
        ) : (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            The bucket list isn&apos;t in the database yet. Apply{" "}
            <code>
              supabase/migrations/20261109120000_bucket_items_and_rate_limits.sql
            </code>{" "}
            in the Supabase SQL editor, then reload this page.
          </p>
        )}

        {gestures ? (
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
        ) : null}

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
                  <span className="mt-1 block text-sm text-foreground/70">
                    {member.timezone}
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
