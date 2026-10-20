import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resetDemoCircle } from "@/lib/demo/reset";
import { getCronSecret } from "@/lib/env.server";
import { getSiteUrl } from "@/lib/env";
import { thinkingOfYouCutoff } from "@/lib/pings/fields";
import { releaseDuePings } from "@/lib/settings/release";
import { createAdminClient } from "@/lib/supabase/admin";

const ONE_HOUR_MS = 60 * 60 * 1000;

const authorization = z.string().regex(/^Bearer\s+\S{16,200}$/);

/**
 * Vercel Cron calls this once a day. It purges circles that have been empty
 * for 30 days, deletes Thinking of You gestures older than
 * PING_RETENTION_DAYS, sweeps passes and auto checkpoints nobody opened,
 * resets the demo couple, and deletes export ZIPs older than an hour.
 *
 * CRON_SECRET must match. A missing secret refuses every caller, including
 * a request with no header.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not ready." }, { status: 500 });
  }

  const purged = await admin.rpc("purge_archived_circles");
  const expired = await admin.rpc("purge_expired_pings", {
    cutoff: thinkingOfYouCutoff(),
  });
  const swept = await admin.rpc("sweep_quiet_circles");
  const together = await admin.rpc("expire_together_booths", {
    target_circle: null,
  });
  const demo = await resetDemoCircle();
  const exportsRemoved = await removeOldExports(admin);
  const released = await releaseDuePings(getSiteUrl() ?? "https://hsummer.app");

  if (
    purged.error ||
    expired.error ||
    swept.error ||
    together.error ||
    !demo.ok
  ) {
    console.error(
      "Daily job failed.",
      purged.error?.code ??
        expired.error?.code ??
        swept.error?.code ??
        together.error?.code,
    );
    return NextResponse.json({ error: "Not ready." }, { status: 500 });
  }

  return NextResponse.json({
    purged: purged.data ?? 0,
    pingsRemoved: expired.data ?? 0,
    passesExpired: swept.data ?? 0,
    togetherExpired: together.data ?? 0,
    demoReset: true,
    exportsRemoved,
    quietReleased: released,
  });
}

function authorized(request: Request): boolean {
  const secret = getCronSecret();
  const header = request.headers.get("authorization");
  if (!secret || !header || !authorization.safeParse(header).success)
    return false;
  const token = header.slice("Bearer ".length);
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function removeOldExports(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
): Promise<number> {
  const listed = await admin.storage
    .from("exports")
    .list("pending", { limit: 1000 });
  if (listed.error || !listed.data) return 0;

  const cutoff = Date.now() - ONE_HOUR_MS;
  const stale = listed.data
    .map((file) => file.name)
    .filter((name) => {
      const timestamp = Number(name.split("_")[0]);
      return Number.isFinite(timestamp) && timestamp < cutoff;
    });

  if (stale.length === 0) return 0;
  const removed = await admin.storage
    .from("exports")
    .remove(stale.map((name) => `pending/${name}`));
  if (removed.error) return 0;
  return stale.length;
}
