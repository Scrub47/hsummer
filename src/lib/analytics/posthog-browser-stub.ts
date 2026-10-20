"use client";

/** Stand-in used when NEXT_PUBLIC_POSTHOG_KEY is empty or still a placeholder. */
export async function importPostHog(): Promise<null> {
  return null;
}
