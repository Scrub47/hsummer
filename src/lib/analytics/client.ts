"use client";

import { analyticsInitOptions } from "@/lib/analytics/config";
import {
  isProductEvent,
  sanitizeEventProperties,
  type ProductEvent,
  type ProductProperties,
} from "@/lib/analytics/events";
import { posthogApiHost } from "@/lib/analytics/hosts";
import { readLocalOptOut, writeLocalOptOut } from "@/lib/analytics/opt-out";
import { redactCapture, type RedactableCapture } from "@/lib/analytics/redact";
import {
  ANALYTICS_SIGNAL_COOKIE,
  isAnalyticsSignal,
} from "@/lib/analytics/signal";
import { importPostHog } from "@/lib/analytics/posthog-browser";
import { getPostHogPublicConfig } from "@/lib/env";

const IDENTIFIED_KEY = "hsummer-analytics-identified";

type PostHogLike = {
  __loaded?: boolean;
  init: (key: string, options: Record<string, unknown>) => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
  identify: (distinctId: string) => void;
  reset: () => void;
  capture: (event: string, properties?: ProductProperties) => void;
};

let client: PostHogLike | null = null;
let loading: Promise<PostHogLike | null> | null = null;
let captureEnabled = false;
let ready = false;
const queued: { event: ProductEvent; properties: ProductProperties }[] = [];

/**
 * Loads posthog-js only when the public key is set. With the key empty,
 * this returns null and does not import the library.
 */
export function loadPostHog(): Promise<PostHogLike | null> {
  // The env read has to be direct so a build with no key can drop the
  // posthog-js import. A helper call is not enough for that.
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return Promise.resolve(null);
  const config = getPostHogPublicConfig();
  if (!config || typeof window === "undefined") return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (loading) return loading;
  loading = importPostHog()
    .then((mod) => {
      if (!mod) return null;
      client = mod;
      return client;
    })
    .catch(() => null);
  return loading;
}

export async function startProductAnalytics(input: {
  userId: string | null;
  optedOut: boolean;
  preferenceKnown: boolean;
  demo: boolean;
}): Promise<void> {
  const config = getPostHogPublicConfig();
  if (!config) return;
  const posthog = await loadPostHog();
  if (!posthog) return;

  const local = readLocalOptOut();
  const optedOut = input.demo
    ? true
    : input.preferenceKnown
      ? input.optedOut
      : (local ?? input.optedOut);
  writeLocalOptOut(optedOut);

  if (!posthog.__loaded) {
    posthog.init(config.key, {
      ...analyticsInitOptions(posthogApiHost(config.host)),
      opt_out_capturing_by_default: optedOut,
      before_send: (event: RedactableCapture) => redactCapture(event),
    });
  }

  if (optedOut) {
    ready = true;
    captureEnabled = false;
    queued.length = 0;
    posthog.opt_out_capturing();
    return;
  }

  ready = true;
  captureEnabled = true;
  posthog.opt_in_capturing();
  if (input.userId) {
    // The id only. No email, no display name, no person properties.
    posthog.identify(input.userId);
    rememberIdentified(true);
  } else if (wasIdentified()) {
    posthog.reset();
    rememberIdentified(false);
  }

  const signal = takeSignal();
  if (signal) posthog.capture(signal);
  for (const item of queued.splice(0)) {
    posthog.capture(item.event, item.properties);
  }
}

/** Stops or resumes capturing in this tab before the server round trip returns. */
export function applyAnalyticsOptOut(optedOut: boolean): void {
  writeLocalOptOut(optedOut);
  captureEnabled = !optedOut && getPostHogPublicConfig() !== null;
  if (optedOut) queued.length = 0;
  if (!getPostHogPublicConfig()) return;
  void loadPostHog().then((posthog) => {
    if (!posthog) return;
    if (optedOut) posthog.opt_out_capturing();
    else posthog.opt_in_capturing();
  });
}

export function trackProductEvent(
  event: ProductEvent,
  properties?: Record<string, unknown>,
): void {
  if (!isProductEvent(event) || !getPostHogPublicConfig()) return;
  if (readLocalOptOut() === true) return;
  const clean = sanitizeEventProperties(properties);
  if (!ready) {
    queued.push({ event, properties: clean });
    return;
  }
  if (!captureEnabled) return;
  void loadPostHog().then((posthog) => {
    if (!captureEnabled || !posthog) return;
    posthog.capture(event, clean);
  });
}

export function resetProductAnalytics(): void {
  captureEnabled = false;
  queued.length = 0;
  rememberIdentified(false);
  if (!getPostHogPublicConfig()) return;
  void loadPostHog().then((posthog) => {
    posthog?.reset();
  });
}

function rememberIdentified(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(IDENTIFIED_KEY, "1");
    else window.sessionStorage.removeItem(IDENTIFIED_KEY);
  } catch {
    // Storage can be blocked. The next signed-out load still calls reset
    // when the cookie from the previous identify is the only leftover.
  }
}

function wasIdentified(): boolean {
  try {
    return window.sessionStorage.getItem(IDENTIFIED_KEY) === "1";
  } catch {
    return false;
  }
}

function takeSignal(): ProductEvent | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${ANALYTICS_SIGNAL_COOKIE}=([^;]*)`),
  );
  const raw = match?.[1] ? decodeURIComponent(match[1]) : null;
  document.cookie = `${ANALYTICS_SIGNAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  return isAnalyticsSignal(raw) ? raw : null;
}
