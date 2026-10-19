import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import { ThinkingOfYou } from "@/components/thinking-of-you";
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
  const showThinkingOfYou =
    circle.circleType === "couple" &&
    circle.status === "active" &&
    partner !== null;
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
  const [pings, bucket, moods, memories, letters, stillUs] = await Promise.all([
    showThinkingOfYou
      ? loadRecentPings(session, circle.id, names, zone)
      : Promise.resolve([]),
    loadBucketItems(session, circle.id, names),
    loadCurrentMoods(session, circle.id, zone),
    loadMemories(session, circle.id, names),
    loadLetters(session, circle.id, names),
    loadStillUs(session, circle.id, zone),
  ]);

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
          {circle.status === "pending" ? (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              This circle is waiting for one more person. Share the invite link.
              You can set a mood, set the Still Us date, open the photo booth,
              add to the memory wall, and start the bucket list now. Letters and
              Thinking of You stay closed until you both are here.
            </p>
          ) : (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              {others.length > 0
                ? `You're here with ${others.map((member) => member.displayName).join(", ")}.`
                : "You're the only one here right now."}{" "}
              {showThinkingOfYou
                ? "Set a mood, check Still Us, write a letter, open the photo booth, add a memory, tap Thinking of You — it goes to your partner — or add to the bucket list."
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
            canShare={showThinkingOfYou}
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
            canWrite={showThinkingOfYou}
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
            Take a strip on this phone. Nothing is saved while you shoot.
            Download keeps it here. Save puts it on the memory wall for everyone
            in the circle.
          </p>
          <Link
            href={`/circles/${circle.id}/booth`}
            className="inline-flex h-12 w-fit items-center rounded-full bg-accent px-5 text-base font-medium text-accent-ink"
          >
            Open the photo booth
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

        {showThinkingOfYou && partner ? (
          <>
            <ThinkingOfYou
              circleId={circle.id}
              partnerName={partner.displayName}
            />
            <RecentPings pings={pings} selfId={session.userId} />
          </>
        ) : null}

        <InvitePanel
          circleId={circle.id}
          status={circle.status}
          invite={circle.invite}
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

        <RenameCircleForm circleId={circle.id} name={circle.name} />
      </main>
    </div>
  );
}
