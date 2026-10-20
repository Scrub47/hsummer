import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthBucket } from "@/lib/auth/attempt";
import { decideAuthLimit } from "@/lib/auth/limit";
import { hashIp, requestIp } from "@/lib/circles/fields";
import { DEMO_ALEX_EMAIL, DEMO_ALEX_ID } from "@/lib/demo/ids";
import { ensureDemoCircle } from "@/lib/demo/reset";
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
 * Signs the browser in as Alex and opens /demo. A person who is already
 * signed in as someone else is not switched over. The circle is created
 * when the scheduled sample letter is missing. The nightly cron rebuilds it.
 */
export async function GET(request: Request) {
  return enterDemo(request);
}

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

  return enterDemo(request);
}

async function enterDemo(request: Request) {
  const origin = redirectOrigin(request);
  const allowed = await limitDemo(request);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many demo tries. Wait a little and try again." },
      { status: 429 },
    );
  }

  const supabase = await createClient();
  const current = await currentUserId(supabase);
  if (current && current !== DEMO_ALEX_ID) {
    return NextResponse.redirect(new URL("/demo?signedin=1", origin), {
      status: 303,
    });
  }
  if (current === DEMO_ALEX_ID) {
    return NextResponse.redirect(new URL("/demo", origin), { status: 303 });
  }

  const reset = await ensureDemoCircle();
  if (!reset.ok) {
    return NextResponse.json(
      { error: "The demo circle isn't ready." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
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
  if (link.error || !tokenHash || !otpType || !OTP_TYPES.has(otpType)) {
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

  return NextResponse.redirect(new URL("/demo", origin), { status: 303 });
}

async function currentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getClaims();
  if (error || typeof data?.claims.sub !== "string") return null;
  return data.claims.sub;
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

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
