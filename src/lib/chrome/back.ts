import { featureFromHash } from "@/lib/circles/feature-tabs";

/**
 * History wins. With an empty stack, a feature hash falls back to that
 * circle's home, and every other screen falls back to its parent route.
 */
export function backTarget(input: {
  historyLength: number;
  hash: string;
  pathname: string;
  search: string;
  fallback: string;
}): { kind: "back" } | { kind: "replace"; href: string } {
  if (input.historyLength > 1) return { kind: "back" };
  if (featureFromHash(input.hash)) {
    return { kind: "replace", href: `${input.pathname}${input.search}` };
  }
  return { kind: "replace", href: input.fallback };
}
