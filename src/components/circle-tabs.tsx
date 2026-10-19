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
import { useEffect, useRef, useState } from "react";

import { featureFromHash, featureHash } from "@/lib/circles/feature-tabs";

const TABS = [
  { id: "ping", label: "Thinking of You", icon: Heart },
  { id: "moods", label: "Moods", icon: Smile },
  { id: "letters", label: "Letters", icon: Mail },
  { id: "bucket", label: "Bucket list", icon: ListChecks },
  { id: "still", label: "Still Us", icon: Hourglass },
  { id: "booth", label: "Photo booth", icon: Camera },
  { id: "memory", label: "Memory wall", icon: Images },
] as const;

export function CircleTabs({
  initial,
  panels,
  home = null,
}: {
  initial: string;
  panels: Record<string, React.ReactNode>;
  /** Circle home. Feature hashes hide it. */
  home?: React.ReactNode;
}) {
  const [tab, setTab] = useState(initial);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function applyHash() {
      const feature = featureFromHash(window.location.hash);
      if (feature && panels[feature]) {
        setTab(feature);
        return;
      }
      if (home != null && window.location.hash.length <= 1) setTab("home");
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("popstate", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("popstate", applyHash);
    };
  }, [panels, home]);

  function select(id: string) {
    setTab(id);
    const hash = featureHash(id);
    if (!hash) return;
    const next = `#${hash}`;
    if (window.location.hash === next) return;
    window.history.pushState(null, "", next);
  }

  useEffect(() => {
    const row = rowRef.current;
    const wrap = row?.parentElement;
    if (!row || !wrap) return;
    const scroller: HTMLDivElement = row;
    const frame: HTMLElement = wrap;
    const chips = [...scroller.querySelectorAll<HTMLElement>('[role="tab"]')];
    const chip = scroller.querySelector<HTMLElement>('[aria-selected="true"]');
    const index = chip ? chips.indexOf(chip) : 0;
    if (chip && index === chips.length - 1) {
      scroller.scrollTo({ left: scroller.scrollWidth });
    } else if (chip && index > 0) {
      const left =
        chip.offsetLeft - (scroller.clientWidth - chip.clientWidth) / 2;
      scroller.scrollTo({ left: Math.max(0, left) });
    } else {
      scroller.scrollTo({ left: 0 });
    }
    function measure() {
      const overflow = scroller.scrollWidth - scroller.clientWidth > 8;
      frame.classList.toggle("fade-left", overflow && scroller.scrollLeft > 8);
      frame.classList.toggle(
        "fade-right",
        overflow &&
          scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 8,
      );
    }
    measure();
    scroller.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      scroller.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [tab]);

  const visible = TABS.filter((item) => panels[item.id] != null);

  return (
    <div className="flex flex-col gap-4">
      <div className="chip-wrap">
        <div
          ref={rowRef}
          className="chip-row"
          role="tablist"
          aria-label="Circle features"
        >
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
                onClick={() => select(item.id)}
              >
                <Icon aria-hidden="true" size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "home" && home != null ? home : null}
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
