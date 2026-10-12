import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

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
  const nextPath = safeNextPath(url.searchParams.get("next"), url.origin);
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.redirect(
      new URL("/sign-in?error=not-configured", url.origin),
    );
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, url.origin));
    }
    return NextResponse.redirect(new URL("/sign-in?error=link", url.origin));
  }

  if (tokenHash && type && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, url.origin));
    }
    return NextResponse.redirect(new URL("/sign-in?error=link", url.origin));
  }

  return NextResponse.redirect(new URL("/sign-in?error=link", url.origin));
}

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isEmailOtpType(value: string): value is EmailOtpType {
  return OTP_TYPES.has(value as EmailOtpType);
}
