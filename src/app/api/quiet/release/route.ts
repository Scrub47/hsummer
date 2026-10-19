import { NextResponse } from "next/server";
import { z } from "zod";

import { getSiteUrl } from "@/lib/env";
import { qstashCallbackUrl, verifyQstashRequest } from "@/lib/schedule/qstash";
import { releaseHeldPing } from "@/lib/settings/release";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * QStash calls this when a quiet-hours ping is due. The signature is
 * checked before any read. The row is sent only if the window has ended.
 */

const bodySchema = z.object({
  heldId: z.string().uuid(),
});

const MAX_BODY = 4096;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const valid = await verifyQstashRequest({
    signature: request.headers.get("upstash-signature"),
    body: raw,
    url: qstashCallbackUrl(request.url),
  });
  if (!valid) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not ready." }, { status: 500 });
  }

  const row = await admin
    .from("held_notifications")
    .select("id, user_id, circle_id, ref_id, deliver_at, delivered_at")
    .eq("id", parsed.data.heldId)
    .maybeSingle();
  if (row.error || !row.data || row.data.delivered_at) {
    return NextResponse.json({ result: "skipped" });
  }
  if (Date.parse(row.data.deliver_at) > Date.now()) {
    return NextResponse.json({ error: "Not due yet." }, { status: 500 });
  }

  const origin = getSiteUrl() ?? new URL(request.url).origin;
  await releaseHeldPing(admin, row.data, origin);
  return NextResponse.json({ result: "released" });
}
