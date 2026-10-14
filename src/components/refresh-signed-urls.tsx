"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Signed Storage URLs stop working while the page is still open. Ask for
 * new ones before that, and again when the person comes back to the tab
 * after the phone has slept.
 */
export function RefreshSignedUrls({
  enabled,
  seconds,
}: {
  enabled: boolean;
  seconds: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = null;
    const refresh = () => {
      router.refresh();
    };
    const intervalMs = Math.max(30_000, (seconds - 45) * 1000);
    const timer = window.setInterval(refresh, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= 60_000) refresh();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, router, seconds]);

  return null;
}
