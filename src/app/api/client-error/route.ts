import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthBucket } from "@/lib/auth/attempt";
import { decideAuthLimit } from "@/lib/auth/limit";
import { hashIp, requestIp } from "@/lib/circles/fields";
import { reportServerError } from "@/lib/monitor/sentry";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(500),
  path: z.string().trim().max(200).optional(),
});

/**
 * The browser reports a short error here. The Sentry DSN never goes to the
 * client. When SENTRY_DSN is unset, the report is dropped and this still
 * returns 204.
 */
export async function POST(request: Request) {
  const allowed = await limit(request);
  if (!allowed) {
    return NextResponse.json({ error: "Too many reports." }, { status: 429 });
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  await reportServerError(new Error(parsed.data.message), {
    path: parsed.data.path,
  });
  return new NextResponse(null, { status: 204 });
}

async function limit(request: Request): Promise<boolean> {
  const key = `clienterr:${hashIp(requestIp(request.headers))}`;
  const shared = await enforceSharedLimit({
    key,
    limit: 20,
    window: "15 m",
    error: "limited",
  });
  if (!shared.ok) return false;
  if (shared.source === "upstash") return true;
  const allowed = await consumeAuthBucket({
    bucket: key,
    limit: 20,
    windowSeconds: 15 * 60,
  });
  return decideAuthLimit({
    upstashEnforced: false,
    databaseAllowed: allowed,
    production: process.env.NODE_ENV === "production",
  }).ok;
}
