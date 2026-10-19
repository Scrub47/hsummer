import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { testSignInAllowed } from "@/lib/auth/local-supabase";
import { redirectOrigin } from "@/lib/auth/request-origin";
import { parseDisplayName, parseTimezone } from "@/lib/profile/fields";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserConfig } from "@/lib/env";

/**
 * Test-only sign-in for Playwright against `npx supabase start`.
 *
 * It creates a local user with the admin API, then redirects to
 * `/auth/callback` with the magic-link token. The callback is what calls
 * `verifyOtp` and writes the session cookie, same as a real magic link.
 * This route does not call Google and it does not send mail to a real inbox.
 *
 * Closed unless both of these are true:
 *   * `E2E_TEST_AUTH=1` (set by the local Playwright config, never on Vercel)
 *   * the Supabase URL is http on localhost or 127.0.0.1
 *
 * A hosted project fails the URL check even if the flag is set. Emails have
 * to end in `@example.com`, so this cannot be aimed at a real address.
 */

const TEST_EMAIL = /^[a-z0-9][a-z0-9._-]{0,60}@example\.com$/;

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export async function POST(request: Request) {
  const config = getSupabaseBrowserConfig();
  if (
    !testSignInAllowed({
      flag: process.env.E2E_TEST_AUTH,
      supabaseUrl: config?.url ?? null,
    })
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseTestSignIn(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "The local test sign-in isn't configured." },
      { status: 500 },
    );
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: parsed.email,
      email_confirm: true,
      user_metadata: {
        display_name: parsed.displayName,
        timezone: parsed.timezone,
      },
    });
  if (createError || !created.user) {
    console.error("Test user was not created.", createError?.message);
    return NextResponse.json(
      { error: "Could not sign in the test user." },
      { status: 500 },
    );
  }

  const aged = await admin
    .from("account_private")
    .update({ age_confirmed_at: new Date().toISOString() })
    .eq("user_id", created.user.id);
  if (aged.error) {
    console.error("Test age confirmation was not saved.", aged.error.code);
    return NextResponse.json(
      { error: "Could not sign in the test user." },
      { status: 500 },
    );
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: parsed.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  const otpType = link?.properties?.verification_type;
  if (linkError || !tokenHash || !otpType || !isEmailOtpType(otpType)) {
    console.error("Test magic link was not created.", linkError?.message);
    return NextResponse.json(
      { error: "Could not sign in the test user." },
      { status: 500 },
    );
  }

  const callback = new URL("/auth/callback", redirectOrigin(request));
  callback.searchParams.set("token_hash", tokenHash);
  callback.searchParams.set("type", otpType);
  callback.searchParams.set("next", "/home");
  return NextResponse.redirect(callback);
}

const testSignInSchema = z.object({
  email: z.string(),
  displayName: z.unknown(),
  timezone: z.unknown().optional(),
});

function parseTestSignIn(
  body: unknown,
):
  | { ok: true; email: string; displayName: string; timezone: string }
  | { ok: false; error: string } {
  const parsed = testSignInSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "That sign-in isn't valid." };
  }
  const record = parsed.data;
  const email = record.email.trim().toLowerCase();
  if (!TEST_EMAIL.test(email)) {
    return {
      ok: false,
      error: "Test sign-in only accepts an @example.com address.",
    };
  }

  const displayName = parseDisplayName(record.displayName);
  if (!displayName.ok) return { ok: false, error: displayName.error };

  const timezoneInput =
    record.timezone === undefined ? "America/Los_Angeles" : record.timezone;
  const timezone = parseTimezone(timezoneInput);
  if (!timezone.ok) return { ok: false, error: timezone.error };

  return {
    ok: true,
    email,
    displayName: displayName.value,
    timezone: timezone.value,
  };
}

function isEmailOtpType(value: string): value is EmailOtpType {
  return OTP_TYPES.has(value as EmailOtpType);
}
