"use client";

import { useSyncExternalStore } from "react";

/**
 * iOS will not show a web-push permission prompt, and will not deliver
 * pushes, unless the site is installed to the Home Screen and opened from
 * that icon. That requirement starts at iOS 16.4. Android and desktop can
 * subscribe from the browser tab.
 *
 * `useSyncExternalStore` reads `navigator` on the client and returns false
 * during server render, so the hint does not cause a hydration mismatch.
 * Enable notifications stays hidden while this is true.
 */
export function useNeedsIosInstall(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function iosInstallRequired(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIos() && !isStandalone();
}

export function InstallHint() {
  const show = useNeedsIosInstall();

  if (!show) return null;

  return (
    <aside className="rounded-2xl border border-line bg-card px-5 py-4 text-sm leading-6">
      <p className="font-medium text-pine">Add Hsummer to your Home Screen</p>
      <p className="mt-1 text-foreground/80">
        On iPhone, notifications only work from the installed app (iOS 16.4 or
        later), not from a Safari tab.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-foreground/80">
        <li>Tap the Share button in Safari.</li>
        <li>Choose Add to Home Screen.</li>
        <li>
          Open Hsummer from the new icon. Enable notifications stays off until
          you do.
        </li>
      </ol>
    </aside>
  );
}

function subscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

function getClientSnapshot(): boolean {
  return isIos() && !isStandalone();
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  const classic = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports itself as a Mac, but it has a touch screen.
  const ipadOs =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return classic || ipadOs;
}

function isStandalone(): boolean {
  const displayMode = window.matchMedia("(display-mode: standalone)").matches;
  const navigatorStandalone =
    "standalone" in navigator &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || navigatorStandalone;
}
