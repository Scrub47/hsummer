import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AGE_COOKIE } from "@/lib/account/age";
import {
  ANALYTICS_SIGNAL_COOKIE,
  analyticsSignalCookie,
} from "@/lib/analytics/signal";
import { redirectOrigin } from "@/lib/auth/request-origin";
import { safeNextPath } from "@/lib/auth/safe-next";
import { isHttpsRequest } from "@/lib/security/headers";
import { createClient } from "@/lib/supabase/server";

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  token_hash: z.string().min(1).max(2048).optional(),
  type: z
    .enum([
      "signup",
      "invite",
      "magiclink",
      "recovery",
      "email_change",
      "email",
    ])
    .optional(),
  next: z.string().max(2000).nullable(),
});

/**
 * Finishes Google sign-in and email magic links.
 *
 * Two shapes land here, depending on the email template:
 *   * `?code=` — PKCE. Works when the link is opened in the same browser
 *     that requested it (the code verifier is a cookie on that browser).
 *   * `?token_hash=&type=email` — works across devices. Use this in the
 *     magic-link template if the link will be opened on a phone.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = redirectOrigin(request);
  const parsed = callbackQuery.safeParse({
    code: url.searchParams.get("code") ?? undefined,
    token_hash: url.searchParams.get("token_hash") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    next: url.searchParams.get("next"),
  });
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/sign-in?error=link", origin));
  }
  const nextPath = safeNextPath(parsed.data.next, origin);
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(
      new URL("/sign-in?error=not-configured", origin),
    );
  }

  const code = parsed.data.code;
  const tokenHash = parsed.data.token_hash;
  const type = parsed.data.type;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await stampAge(supabase, request);
      return finishSignIn(request, supabase, nextPath, origin);
    }
    return NextResponse.redirect(new URL("/sign-in?error=link", origin));
  }

  if (tokenHash && type && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      await stampAge(supabase, request);
      return finishSignIn(request, supabase, nextPath, origin);
    }
    return NextResponse.redirect(new URL("/sign-in?error=link", origin));
  }

  return NextResponse.redirect(new URL("/sign-in?error=link", origin));
}

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

async function finishSignIn(
  request: NextRequest,
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  nextPath: string,
  origin: string,
) {
  const response = NextResponse.redirect(new URL(nextPath, origin));
  const { data } = await supabase.auth.getUser();
  const created = data.user?.created_at;
  const age = created ? Date.now() - Date.parse(created) : Number.NaN;
  // A brand-new account, not a returning sign-in. Two minutes is enough
  // for the redirect and short enough that a second visit does not count.
  if (Number.isFinite(age) && age >= 0 && age < 2 * 60 * 1000) {
    response.cookies.set(
      ANALYTICS_SIGNAL_COOKIE,
      "signed_up",
      analyticsSignalCookie(isHttpsRequest(request)),
    );
  }
  return response;
}

async function stampAge(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  request: NextRequest,
): Promise<void> {
  if (request.cookies.get(AGE_COOKIE)?.value !== "1") return;
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (typeof userId !== "string") return;
  await supabase
    .from("account_private")
    .update({ age_confirmed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("age_confirmed_at", null);
}

function isEmailOtpType(value: string): value is EmailOtpType {
  return OTP_TYPES.has(value as EmailOtpType);
}
