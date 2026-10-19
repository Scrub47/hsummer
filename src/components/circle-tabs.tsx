"use client";

import {
  Camera,
  Heart,
  Hourglass,
  Images,
  ListChecks,
  Mail,
  Smile,
} from "lucide-react";
import { useEffect, useState } from "react";

const TABS = [
  { id: "ping", label: "Thinking of You", icon: Heart },
  { id: "moods", label: "Moods", icon: Smile },
  { id: "letters", label: "Letters", icon: Mail },
  { id: "bucket", label: "Bucket list", icon: ListChecks },
  { id: "still", label: "Still Us", icon: Hourglass },
  { id: "booth", label: "Photo booth", icon: Camera },
  { id: "memory", label: "Memory wall", icon: Images },
] as const;

const HASH_TO_TAB: Record<string, string> = {
  "memory-heading": "memory",
  memory: "memory",
  "letters-heading": "letters",
  "mood-heading": "moods",
  "still-us-heading": "still",
  "bucket-heading": "bucket",
};

export function CircleTabs({
  initial,
  panels,
}: {
  initial: string;
  panels: Record<string, React.ReactNode>;
}) {
  const [tab, setTab] = useState(initial);

  useEffect(() => {
    function applyHash() {
      const id = window.location.hash.replace("#", "");
      const next = HASH_TO_TAB[id];
      if (next && panels[next]) setTab(next);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [panels]);

  const visible = TABS.filter((item) => panels[item.id] != null);

  return (
    <div className="flex flex-col gap-4">
      <div className="chip-row" role="tablist" aria-label="Circle features">
        {visible.map((item) => {
          const Icon = item.icon;
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="chip"
              id={`tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              <Icon aria-hidden="true" size={16} />
              {item.label}
            </button>
          );
        })}
      </div>
      {visible.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`panel-${item.id}`}
          aria-labelledby={`tab-${item.id}`}
          hidden={tab !== item.id}
        >
          {panels[item.id]}
        </div>
      ))}
    </div>
  );
}
