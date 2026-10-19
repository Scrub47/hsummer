"use client";

import { useEffect, useState } from "react";

import { formatLocalTime, friendlyZoneLabel } from "@/lib/time/zones";

export function LocalTimes({
  people,
}: {
  people: { name: string; timeZone: string }[];
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <ul className="flex flex-col gap-1">
      {people.map((person) => (
        <li
          key={`${person.name}-${person.timeZone}`}
          className="flex items-baseline justify-between gap-3 text-sm"
        >
          <span className="font-semibold">{person.name}</span>
          <span className="text-muted">
            {now ? formatLocalTime(person.timeZone, now) : "—"}
            <span className="ml-2">{friendlyZoneLabel(person.timeZone)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
