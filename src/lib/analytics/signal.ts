/**
 * A one-time event name carried from a server redirect to the browser.
 * The value is only `signed_up` or `partner_joined`. No email, no name.
 * HttpOnly stays off so the analytics module can read it and delete it.
 */

export const ANALYTICS_SIGNAL_COOKIE = "hsummer_track";

export const ANALYTICS_SIGNALS = ["signed_up", "partner_joined"] as const;

export type AnalyticsSignal = (typeof ANALYTICS_SIGNALS)[number];

export function isAnalyticsSignal(
  value: string | null | undefined,
): value is AnalyticsSignal {
  return value === "signed_up" || value === "partner_joined";
}

export function analyticsSignalCookie(https: boolean): {
  httpOnly: false;
  sameSite: "lax";
  path: string;
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 120,
    secure: https,
  };
}
