import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { redirectOrigin } from "@/lib/auth/request-origin";
import { safeNextPath } from "@/lib/auth/safe-next";
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
      return NextResponse.redirect(new URL(nextPath, origin));
    }
    return NextResponse.redirect(new URL("/sign-in?error=link", origin));
  }

  if (tokenHash && type && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, origin));
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

function isEmailOtpType(value: string): value is EmailOtpType {
  return OTP_TYPES.has(value as EmailOtpType);
}
