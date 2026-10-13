import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { InvitePanel } from "@/components/invite-panel";
import { ProfileAvatar } from "@/components/profile-avatar";
import { RecentPings } from "@/components/recent-pings";
import { RenameCircleForm } from "@/components/rename-circle-form";
import { SignedInHeader } from "@/components/signed-in-header";
import { ThinkingOfYou } from "@/components/thinking-of-you";
import { loadCircle } from "@/lib/circles/load";
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
  const pings = showThinkingOfYou
    ? await loadRecentPings(
        session,
        circle.id,
        new Map(
          circle.members.map((member) => [member.userId, member.displayName]),
        ),
        self?.timezone ?? "UTC",
      )
    : [];

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
              Until then, this screen is the invite — not letters or a ping.
            </p>
          ) : (
            <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
              {others.length > 0
                ? `You're here with ${others.map((member) => member.displayName).join(", ")}.`
                : "You're both here."}{" "}
              {showThinkingOfYou
                ? "Tap Thinking of You. It goes to your partner."
                : "Letters and the bucket list come in later weeks."}
            </p>
          )}
        </div>

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
