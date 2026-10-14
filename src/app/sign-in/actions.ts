"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { enforceAuthLimits } from "@/lib/auth/attempt";
import {
  GOOGLE_IP_LIMIT,
  MAGIC_EMAIL_LIMIT,
  MAGIC_IP_LIMIT,
  authEmailBucket,
  authIpBucket,
} from "@/lib/auth/limit";
import { actionOrigin } from "@/lib/auth/request-origin";
import { safeNextPath } from "@/lib/auth/safe-next";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { hashIp, requestIp } from "@/lib/circles/fields";
import { getSupabaseBrowserConfig, getTurnstileSiteKey } from "@/lib/env";
import { getTurnstileSecret } from "@/lib/env.server";
import { parseTimezone } from "@/lib/profile/fields";
import { createClient } from "@/lib/supabase/server";

export type SignInResult =
  | { ok: true; kind: "email" }
  | { ok: true; kind: "google"; url: string }
  | { ok: false; error: string };

const emailSchema = z.string().trim().email().max(320);
const nextSchema = z.string().max(2000).optional();
const captchaSchema = z.string().trim().min(1).max(2048);
const timezoneSchema = z.string().max(64).optional();

const NOT_CONFIGURED =
  "Supabase isn't configured yet. Add your project URL and publishable key to .env.local, then restart the dev server.";
const EMAIL_FAILED =
  "The magic link couldn't be sent. Check the email address and try again.";
const GOOGLE_FAILED =
  "Google sign-in didn't start. Check that the Google provider is enabled.";
const CAPTCHA_REQUIRED = "Complete the check, then try again.";

/**
 * Sends a magic link. The address is validated here. The signed-in user id
 * does not exist yet, so the cap is per IP hash and per email hash. Supabase
 * still has to be willing to send the mail; its own rate limit and, when
 * enabled, its captcha check apply even to someone who calls the Auth API
 * directly.
 */
export async function requestMagicLink(input: {
  email: unknown;
  nextPath?: unknown;
  captchaToken?: unknown;
  timezone?: unknown;
}): Promise<SignInResult> {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) return { ok: false, error: EMAIL_FAILED };

  const captcha = readCaptcha(input.captchaToken);
  if (!captcha.ok) return { ok: false, error: captcha.error };

  const headerList = await headers();
  const limited = await enforceAuthLimits([
    {
      key: authIpBucket("magic", hashIp(requestIp(headerList))),
      limit: MAGIC_IP_LIMIT,
    },
    { key: authEmailBucket(email.data), limit: MAGIC_EMAIL_LIMIT },
  ]);
  if (!limited.ok) return { ok: false, error: limited.error };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };

  const origin = actionOrigin(headerList);
  const nextPath = readNext(input.nextPath, origin);
  const timezone = readTimezone(input.timezone);
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: callbackUrl(origin, nextPath),
      captchaToken: captcha.token,
      data: { timezone },
    },
  });

  if (error) {
    console.error("Magic link was not sent.", error.code);
    return { ok: false, error: EMAIL_FAILED };
  }
  return { ok: true, kind: "email" };
}

/** Starts Google sign-in and returns the provider URL. The browser navigates. */
export async function startGoogleSignIn(input: {
  nextPath?: unknown;
  captchaToken?: unknown;
}): Promise<SignInResult> {
  const captcha = readCaptcha(input.captchaToken);
  if (!captcha.ok) return { ok: false, error: captcha.error };

  const headerList = await headers();
  const limited = await enforceAuthLimits([
    {
      key: authIpBucket("google", hashIp(requestIp(headerList))),
      limit: GOOGLE_IP_LIMIT,
    },
  ]);
  if (!limited.ok) return { ok: false, error: limited.error };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };

  const origin = actionOrigin(headerList);
  const nextPath = readNext(input.nextPath, origin);
  // Auth's /authorize route does not check captcha. A token is single-use,
  // so this check is the one that runs for Google. Magic link sends its
  // token to Supabase instead.
  if (captcha.token) {
    const secret = getTurnstileSecret();
    if (!secret) {
      console.error("Turnstile secret is missing; Google sign-in was refused.");
      return { ok: false, error: GOOGLE_FAILED };
    }
    const ip = requestIp(headerList);
    const verified = await verifyTurnstile({
      token: captcha.token,
      secret,
      remoteIp: ip === "unknown" ? null : ip,
    });
    if (!verified) return { ok: false, error: CAPTCHA_REQUIRED };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(origin, nextPath),
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url || !isSupabaseAuthUrl(data.url)) {
    console.error("Google sign-in did not return a URL.", error?.code);
    return { ok: false, error: GOOGLE_FAILED };
  }
  return { ok: true, kind: "google", url: data.url };
}

function callbackUrl(origin: string, nextPath: string): string {
  const callback = new URL("/auth/callback", origin);
  if (nextPath !== "/home") callback.searchParams.set("next", nextPath);
  return callback.toString();
}

function readNext(value: unknown, origin: string): string {
  const parsed = nextSchema.safeParse(value);
  return safeNextPath(parsed.success ? (parsed.data ?? null) : null, origin);
}

function readTimezone(value: unknown): string {
  const parsed = timezoneSchema.safeParse(value);
  if (!parsed.success || !parsed.data) return "UTC";
  const zone = parseTimezone(parsed.data);
  return zone.ok ? zone.value : "UTC";
}

function readCaptcha(
  value: unknown,
): { ok: true; token: string | undefined } | { ok: false; error: string } {
  if (!getTurnstileSiteKey()) return { ok: true, token: undefined };
  const parsed = captchaSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: CAPTCHA_REQUIRED };
  return { ok: true, token: parsed.data };
}

function isSupabaseAuthUrl(value: string): boolean {
  const config = getSupabaseBrowserConfig();
  if (!config) return false;
  try {
    const url = new URL(value);
    const base = new URL(config.url);
    return url.origin === base.origin && url.pathname.startsWith("/auth/v1/");
  } catch {
    return false;
  }
}
