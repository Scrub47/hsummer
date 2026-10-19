import { NextResponse } from "next/server";
import { z } from "zod";

import { getSiteUrl } from "@/lib/env";
import { notifyLetterRecipient } from "@/lib/letters/notify";
import { qstashCallbackUrl, verifyQstashRequest } from "@/lib/schedule/qstash";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * QStash calls this when a scheduled letter is due.
 *
 * The signature is checked before any read or write, and it has to be for
 * this exact URL. A missing key, a bad signature, a signature for another
 * URL, or an unsigned body does not deliver the letter. The handler
 * then re-checks that both people are still in the circle. The push says
 * "You have a new letter." and nothing else.
 *
 * Node.js runtime (the default). Signature verification uses Node crypto.
 */

const bodySchema = z.object({
  letterId: z.string().uuid(),
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

  const delivered = await admin.rpc("deliver_scheduled_letter", {
    target: parsed.data.letterId,
  });
  if (delivered.error || typeof delivered.data !== "string") {
    console.error("Scheduled letter delivery failed.", delivered.error?.code);
    return NextResponse.json({ error: "Not ready." }, { status: 500 });
  }

  if (delivered.data === "early") {
    return NextResponse.json({ error: "Not due yet." }, { status: 500 });
  }

  if (delivered.data === "delivered") {
    const row = await admin
      .from("letters")
      .select("to_user_id, circle_id")
      .eq("id", parsed.data.letterId)
      .maybeSingle();
    if (row.data?.to_user_id && row.data.circle_id) {
      const origin = getSiteUrl() ?? new URL(request.url).origin;
      await notifyLetterRecipient({
        recipientId: row.data.to_user_id,
        origin,
        circleId: row.data.circle_id,
      });
    }
  }

  return NextResponse.json({ result: delivered.data });
}
