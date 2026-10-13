import type { PingListItem } from "@/lib/pings/load";

export function RecentPings({
  pings,
  selfId,
}: {
  pings: PingListItem[];
  selfId: string;
}) {
  return (
    <section>
      <h2 className="font-serif text-2xl tracking-tight">Recent</h2>
      {pings.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-foreground/70">
          No pings yet. The first one is the button above.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {pings.map((ping) => (
            <li
              key={ping.id}
              className="flex items-baseline justify-between gap-4 rounded-3xl border border-line bg-card px-4 py-3"
            >
              <span>
                <span className="font-medium">
                  {ping.fromUserId === selfId ? "You" : ping.fromName}
                </span>
                <span className="mt-1 block text-sm text-foreground/80">
                  {ping.phrase}
                </span>
              </span>
              <time
                dateTime={ping.sentAt}
                className="shrink-0 text-sm text-foreground/60"
              >
                {ping.when}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
