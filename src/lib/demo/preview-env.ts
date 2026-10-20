import { getSupabaseBrowserConfig } from "@/lib/env";

/**
 * Local stand-in used when this machine has no Supabase project.
 * A configured project, including production, never takes this path.
 * Vercel is refused as well, so a stray env var cannot serve fiction
 * in place of a real circle.
 */
export function demoPreviewEnabled(): boolean {
  if (process.env.HSUMMER_DEMO_PREVIEW !== "1") return false;
  if (process.env.VERCEL === "1") return false;
  if (getSupabaseBrowserConfig()) return false;
  return true;
}
