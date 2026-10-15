import "server-only";

import { getSentryDsn } from "@/lib/env.server";

/**
 * Optional error report. When SENTRY_DSN is unset, this does nothing and the
 * app keeps working. The DSN stays on the server. The browser posts a short
 * message to /api/client-error, which calls this.
 *
 * Nothing here includes an email, a letter, or a photo.
 */

const MESSAGE_MAX = 500;

export function parseSentryDsn(
  dsn: string,
): { storeUrl: string; key: string } | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const key = decodeURIComponent(url.username);
  const projectId = url.pathname.replace(/^\//, "");
  if (!key || !/^\d+$/.test(projectId)) return null;
  return {
    key,
    storeUrl: `${url.origin}/api/${projectId}/store/`,
  };
}

export async function reportServerError(
  error: unknown,
  extra?: { path?: string },
): Promise<void> {
  const dsn = getSentryDsn();
  if (!dsn) return;
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;

  const message = clip(error instanceof Error ? error.message : "Error");
  const stack = error instanceof Error ? clip(error.stack ?? "", 2000) : "";
  const eventId = crypto.randomUUID().replaceAll("-", "");

  try {
    await fetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=hsummer/1.0, sentry_key=${parsed.key}`,
      },
      body: JSON.stringify({
        event_id: eventId,
        timestamp: new Date().toISOString(),
        platform: "node",
        level: "error",
        message,
        extra: extra?.path ? { path: clip(extra.path, 200) } : undefined,
        exception: stack
          ? {
              values: [
                {
                  type: error instanceof Error ? error.name : "Error",
                  value: message,
                  stacktrace: {
                    frames: [{ filename: "app", function: stack }],
                  },
                },
              ],
            }
          : undefined,
      }),
    });
  } catch {
    console.error("Sentry did not accept the report.");
  }
}

function clip(value: string, max = MESSAGE_MAX): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
