"use client";

/**
 * The only module that imports posthog-js. next.config points the
 * `@/lib/analytics/posthog-browser` alias here when NEXT_PUBLIC_POSTHOG_KEY
 * is a real key, and at the stub otherwise, so an unset key leaves the
 * library out of the bundle.
 */
export async function importPostHog(): Promise<{
  init: (key: string, options: Record<string, unknown>) => void;
  opt_out_capturing: () => void;
  opt_in_capturing: () => void;
  identify: (distinctId: string) => void;
  reset: () => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  __loaded?: boolean;
} | null> {
  const mod = await import("posthog-js");
  return mod.default;
}
