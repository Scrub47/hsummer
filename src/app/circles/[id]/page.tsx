import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BucketList } from "@/components/bucket-list";
import { CircleMoods } from "@/components/circle-moods";
import { InvitePanel } from "@/components/invite-panel";
import { ProfileAvatar } from "@/components/profile-avatar";
import { RecentPings } from "@/components/recent-pings";
import { RenameCircleForm } from "@/components/rename-circle-form";
import { SignedInHeader } from "@/components/signed-in-header";
import { ThinkingOfYou } from "@/components/thinking-of-you";
import { loadBucketItems } from "@/lib/bucket/load";
import { loadCircle } from "@/lib/circles/load";
import { loadCurrentMoods } from "@/lib/moods/load";
import { loadRecentPings } from "@/lib/pings/load";
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
  const [pings, bucket, moods] = await Promise.all([
    showThinkingOfYou
      ? loadRecentPings(session, circle.id, names, zone)
      : Promise.resolve([]),
    loadBucketItems(session, circle.id, names),
    loadCurrentMoods(session, circle.id, zone),
  ]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
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
              You can set a mood and start the bucket list now. Thinking of You
              stays closed until you both are here.
            </p>
          ) : (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              {others.length > 0
                ? `You're here with ${others.map((member) => member.displayName).join(", ")}.`
                : "You're the only one here right now."}{" "}
              {showThinkingOfYou
                ? "Set a mood, tap Thinking of You — it goes to your partner — or add to the bucket list."
                : "Set a mood or add to the bucket list. Letters come in a later week."}
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
