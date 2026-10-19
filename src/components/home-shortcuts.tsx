import Link from "next/link";
import {
  Camera,
  Heart,
  Hourglass,
  Images,
  ListChecks,
  Mail,
  Smile,
} from "lucide-react";

import { BearMark } from "@/components/bear-mark";

const tiles = [
  { hash: "ping", label: "Thinking of You", icon: Heart },
  { hash: "mood-heading", label: "Moods", icon: Smile },
  { hash: "letters-heading", label: "Letters", icon: Mail },
  { hash: "bucket-heading", label: "Bucket list", icon: ListChecks },
  { hash: "still-us-heading", label: "Still Us", icon: Hourglass },
  { hash: "booth", label: "Photo booth", icon: Camera },
  { hash: "memory-heading", label: "Memory wall", icon: Images },
] as const;

/** Icon tiles under the home card, one for each circle feature. */
export function HomeShortcuts({ circleId }: { circleId: string | null }) {
  const base = circleId ? `/circles/${circleId}` : "/circles";

  return (
    <section className="home-shortcuts" aria-label="Circle shortcuts">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-hand text-3xl leading-none">Your circle</h2>
        <BearMark size={76} alt="" />
      </div>
      <div className="tile-grid">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.hash}
              href={`${base}#${tile.hash}`}
              className="tile"
            >
              <Icon aria-hidden="true" size={18} />
              {tile.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
