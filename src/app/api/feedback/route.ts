import { NextResponse } from "next/server";

import { consumeAuthBucket } from "@/lib/auth/attempt";
import { decideAuthLimit } from "@/lib/auth/limit";
import { hashIp, requestIp } from "@/lib/circles/fields";
import {
  FEEDBACK_LIMIT,
  FEEDBACK_RATE_LIMIT_MESSAGE,
  FEEDBACK_WINDOW_MINUTES,
  feedbackBodySchema,
  feedbackWriteFailure,
} from "@/lib/feedback/fields";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { getSession } from "@/lib/supabase/session";
import { APP_VERSION } from "@/lib/version";

/**
 * Stores one feedback row for the signed-in person. The insert uses their
 * session, so row level security applies. The response does not read the
 * row back: authenticated has no select grant.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const limited = await limit(request, session.userId);
  if (!limited.ok) {
    return NextResponse.json(
      { error: FEEDBACK_RATE_LIMIT_MESSAGE },
      { status: limited.status },
    );
  }

  const raw: unknown = await request.json().catch(() => null);
  const parsed = feedbackBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That note isn't valid." },
      { status: 400 },
    );
  }

  const userAgent = (request.headers.get("user-agent") ?? "unknown")
    .trim()
    .slice(0, 512);
  const { error } = await session.supabase.from("feedback").insert({
    user_id: session.userId,
    rating: parsed.data.rating,
    message: parsed.data.message ?? null,
    category: parsed.data.category ?? null,
    app_version: APP_VERSION.slice(0, 32),
    user_agent: userAgent.length > 0 ? userAgent : "unknown",
  });

  if (error) {
    const friendly = feedbackWriteFailure(error.message);
    if (friendly) {
      const status = error.message.includes("hsummer_feedback_rate_limited")
        ? 429
        : 403;
      return NextResponse.json({ error: friendly }, { status });
    }
    console.error("feedback insert failed.", error.code);
    return NextResponse.json(
      { error: "That note wasn't saved." },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}

async function limit(
  request: Request,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: 429 | 503 }> {
  const shared = await enforceSharedLimit({
    key: `feedback:${userId}`,
    limit: FEEDBACK_LIMIT,
    window: `${FEEDBACK_WINDOW_MINUTES} m`,
    error: "limited",
  });
  if (!shared.ok) return { ok: false, status: 429 };
  if (shared.source === "upstash") return { ok: true };

  const ipKey = `feedback-ip:${hashIp(requestIp(request.headers))}`;
  const allowed = await consumeAuthBucket({
    bucket: `feedback-user:${userId}`,
    limit: FEEDBACK_LIMIT,
    windowSeconds: FEEDBACK_WINDOW_MINUTES * 60,
  });
  const ipAllowed = await consumeAuthBucket({
    bucket: ipKey,
    limit: 20,
    windowSeconds: FEEDBACK_WINDOW_MINUTES * 60,
  });
  const decision = decideAuthLimit({
    upstashEnforced: false,
    databaseAllowed:
      allowed === true && ipAllowed === true
        ? true
        : allowed === false || ipAllowed === false
          ? false
          : null,
    production: process.env.NODE_ENV === "production",
  });
  if (decision.ok) return { ok: true };
  if (decision.reason === "limited") return { ok: false, status: 429 };
  return { ok: false, status: 503 };
}
