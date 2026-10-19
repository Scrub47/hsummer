import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthBucket } from "@/lib/auth/attempt";
import { decideAuthLimit } from "@/lib/auth/limit";
import { hashIp, requestIp } from "@/lib/circles/fields";
import { DEMO_ALEX_EMAIL, DEMO_CIRCLE_ID } from "@/lib/demo/ids";
import { resetDemoCircle } from "@/lib/demo/reset";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { isSameOriginPost, redirectOrigin } from "@/lib/auth/request-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({}).strict();

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

/**
 * Signs the browser in as Alex, the fictional demo account, and opens that
 * couple circle. Jordan is the other member. No real person's data is read.
 * Uploads and pushes stay off. The circle is rebuilt first so a previous
 * visitor cannot leave changes behind.
 */
export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const raw = await request.text();
  const parsed = bodySchema.safeParse(
    raw.length === 0 || !raw.trim().startsWith("{") ? {} : safeJson(raw),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const allowed = await limitDemo(request);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many demo tries. Wait a little and try again." },
      { status: 429 },
    );
  }

  const reset = await resetDemoCircle();
  if (!reset.ok) {
    return NextResponse.json(
      { error: "The demo circle isn't ready." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  if (!admin || !supabase) {
    return NextResponse.json(
      { error: "The demo circle isn't ready." },
      { status: 500 },
    );
  }

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_ALEX_EMAIL,
  });
  const tokenHash = link.data?.properties?.hashed_token;
  const otpType = link.data?.properties?.verification_type;
  if (link.error || !tokenHash || !otpType || !isEmailOtpType(otpType)) {
    console.error("Demo sign-in link was not created.");
    return NextResponse.json(
      { error: "The demo circle isn't ready." },
      { status: 500 },
    );
  }

  const verified = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType,
  });
  if (verified.error) {
    console.error("Demo sign-in was not accepted.");
    return NextResponse.json(
      { error: "The demo circle isn't ready." },
      { status: 500 },
    );
  }

  const next = new URL(
    `/circles/${reset.circleId || DEMO_CIRCLE_ID}`,
    redirectOrigin(request),
  );
  return NextResponse.redirect(next, { status: 303 });
}

async function limitDemo(request: Request): Promise<boolean> {
  const key = `demo:${hashIp(requestIp(request.headers))}`;
  const shared = await enforceSharedLimit({
    key,
    limit: 10,
    window: "15 m",
    error: "limited",
  });
  if (!shared.ok) return false;
  if (shared.source === "upstash") return true;

  const allowed = await consumeAuthBucket({
    bucket: key,
    limit: 10,
    windowSeconds: 15 * 60,
  });
  return decideAuthLimit({
    upstashEnforced: false,
    databaseAllowed: allowed,
    production: process.env.NODE_ENV === "production",
  }).ok;
}

function isEmailOtpType(value: string): value is EmailOtpType {
  return OTP_TYPES.has(value);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
