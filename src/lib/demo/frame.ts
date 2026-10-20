import { DEMO_ALEX_ID } from "@/lib/demo/ids";

/** The portfolio origin allowed to frame /demo. Exact host, no wildcard. */
export const DEMO_FRAME_PARENT = "https://portfolio-isaac-hsu.vercel.app";

export function isDemoDocument(pathname: string): boolean {
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

/**
 * /demo is always frameable so an iframe can load it before a session
 * exists. After Alex is signed in, the rest of that browser's pages are
 * frameable too, or the iframe would go blank on the first link. A real
 * account never matches this.
 */
export function allowsDemoFraming(input: {
  pathname: string;
  userId: string | null;
  preview: boolean;
}): boolean {
  if (isDemoDocument(input.pathname)) return true;
  if (input.preview) return true;
  return input.userId === DEMO_ALEX_ID;
}

export function demoFrameAncestors(input: {
  demoFrame: boolean;
  developmentOrigin: string | null;
}): string {
  if (!input.demoFrame) return "'none'";
  const sources = ["'self'", DEMO_FRAME_PARENT];
  if (
    input.developmentOrigin &&
    input.developmentOrigin !== DEMO_FRAME_PARENT
  ) {
    sources.push(input.developmentOrigin);
  }
  return sources.join(" ");
}
