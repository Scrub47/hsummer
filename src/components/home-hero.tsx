import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { LocalTimes } from "@/components/local-times";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ThinkingOfYou } from "@/components/thinking-of-you";

export type HeroPerson = {
  name: string;
  timeZone: string;
  avatarUrl: string | null;
  moodEmoji: string | null;
  moodLabel: string | null;
};

export function HomeHero({
  greeting,
  selfZone,
  partner,
  people,
  countdown,
  circleHref,
  circleId,
  canPing,
  pingName,
  pingPeople,
  pending,
  pingLocked = false,
}: {
  greeting: string;
  selfZone: string | null;
  partner: HeroPerson | null;
  people: HeroPerson[];
  countdown: { label: string; daysText: string } | null;
  circleHref: string;
  circleId: string | null;
  canPing: boolean;
  pingName: string;
  pingPeople: { userId: string; displayName: string }[];
  pending: boolean;
  pingLocked?: boolean;
}) {
  const clocks = [
    ...(selfZone ? [{ name: "You", timeZone: selfZone }] : []),
    ...people.map((person) => ({
      name: person.name,
      timeZone: person.timeZone,
    })),
  ];

  return (
    <section className="hero-card" aria-labelledby="home-greeting">
      <div>
        <h1 id="home-greeting" className="text-2xl font-bold tracking-tight">
          {greeting}
        </h1>
      </div>

      {partner ? (
        <div className="flex items-center gap-3">
          <ProfileAvatar
            name={partner.name}
            url={partner.avatarUrl}
            alt=""
            className="h-16 w-16 text-xl"
          />
          <div>
            <p className="text-lg font-bold">{partner.name}</p>
            <p className="text-sm text-muted">
              {partner.moodEmoji ? (
                <>
                  <span aria-hidden="true">{partner.moodEmoji} </span>
                  {partner.moodLabel}
                </>
              ) : (
                "No mood yet"
              )}
            </p>
          </div>
        </div>
      ) : people.length > 1 ? (
        <ul className="flex gap-3 overflow-x-auto">
          {people.map((person) => (
            <li
              key={person.name}
              className="flex min-w-16 flex-col items-center gap-1"
            >
              <ProfileAvatar
                name={person.name}
                url={person.avatarUrl}
                alt=""
                className="h-12 w-12 text-lg"
              />
              <span className="text-xs font-semibold">{person.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No letters yet"
          detail="Start a circle and they'll show up here."
        />
      )}

      {clocks.length > 0 ? <LocalTimes people={clocks} /> : null}

      {countdown ? (
        <p className="text-sm">
          <span className="font-bold">{countdown.daysText}</span>
          <span className="text-muted"> until {countdown.label}</span>
        </p>
      ) : null}

      {canPing && circleId ? (
        <ThinkingOfYou
          circleId={circleId}
          partnerName={pingName}
          people={pingPeople}
          hero
          readOnly={pingLocked}
        />
      ) : (
        <Link href={circleHref} className="btn">
          {pending ? "Share the invite" : "Open your circle"}
        </Link>
      )}
    </section>
  );
}
