"use client";

import { useEffect } from "react";

import {
  resetProductAnalytics,
  startProductAnalytics,
} from "@/lib/analytics/client";

/**
 * Starts PostHog when the public key is set, and resets it when the
 * sign-out form is submitted. With the key unset, startProductAnalytics
 * returns before importing the library.
 */
export function ProductAnalytics({
  userId,
  optedOut,
  preferenceKnown,
  demo,
}: {
  userId: string | null;
  optedOut: boolean;
  preferenceKnown: boolean;
  demo: boolean;
}) {
  useEffect(() => {
    void startProductAnalytics({ userId, optedOut, preferenceKnown, demo });
  }, [userId, optedOut, preferenceKnown, demo]);

  useEffect(() => {
    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.getAttribute("action") === "/auth/sign-out") {
        resetProductAnalytics();
      }
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return null;
}
