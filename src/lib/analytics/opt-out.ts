/** This browser's copy of the Settings toggle. The account column is the record. */

export const ANALYTICS_OPT_OUT_KEY = "hsummer-analytics-opt-out";

export function readLocalOptOut(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeLocalOptOut(optedOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYTICS_OPT_OUT_KEY, optedOut ? "1" : "0");
  } catch {
    // Private mode can refuse storage. The account column still holds it.
  }
}
