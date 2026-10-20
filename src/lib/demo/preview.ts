import { cookies, headers } from "next/headers";

import { DEMO_PREVIEW_COOKIE } from "@/lib/demo/ids";
import { demoPreviewEnabled } from "@/lib/demo/preview-env";

export { demoPreviewEnabled };

export async function demoPreviewRequested(): Promise<boolean> {
  if (!demoPreviewEnabled()) return false;
  const jar = await cookies();
  return jar.get(DEMO_PREVIEW_COOKIE)?.value === "1";
}

/** Browser origin for fixture image links. Loopback hosts are trusted. */
export async function demoDocumentOrigin(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    headerList.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    headerList.get("host") ??
    "localhost:3000";
  const proto =
    forwarded === "https" || forwarded === "http"
      ? forwarded
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  return `${proto}://${host}`;
}
