"use client";

import { House, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { tabBarTopPx } from "@/lib/chrome/tab-bar";

const tabs = [
  { href: "/home", id: "home", label: "Home", icon: House },
  { href: "/circles", id: "circles", label: "Circle", icon: Users },
  { href: "/profile", id: "profile", label: "Profile", icon: UserRound },
] as const;

function emptySubscribe() {
  return () => {};
}

function tabBarRoot() {
  return document.getElementById("tab-bar-root");
}

function serverTabBarRoot() {
  return null;
}

/**
 * The bar is portaled to `#tab-bar-root`, a direct child of body, so a
 * transformed or animated ancestor cannot become its containing block.
 * iOS standalone momentum scroll is corrected against the visual viewport.
 */
export function TabBar({
  current,
}: {
  current: "home" | "profile" | "circles";
}) {
  const navRef = useRef<HTMLElement>(null);
  const root = useSyncExternalStore(
    emptySubscribe,
    tabBarRoot,
    serverTabBarRoot,
  );

  useEffect(() => {
    const bar = navRef.current;
    if (!bar) return;

    function pin() {
      const node = navRef.current;
      const viewport = window.visualViewport;
      if (!node || !viewport) return;
      const top = tabBarTopPx({
        offsetTop: viewport.offsetTop,
        viewportHeight: viewport.height,
        barHeight: node.offsetHeight,
      });
      node.style.top = `${top}px`;
      node.style.bottom = "auto";
    }

    pin();
    const viewport = window.visualViewport;
    viewport?.addEventListener("scroll", pin);
    viewport?.addEventListener("resize", pin);
    window.addEventListener("scroll", pin, { passive: true });
    window.addEventListener("orientationchange", pin);
    return () => {
      viewport?.removeEventListener("scroll", pin);
      viewport?.removeEventListener("resize", pin);
      window.removeEventListener("scroll", pin);
      window.removeEventListener("orientationchange", pin);
    };
  }, [root]);

  const nav = (
    <nav ref={navRef} className="tab-bar" aria-label="Primary">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = current === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={20} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );

  if (!root) return null;
  return createPortal(nav, root);
}
