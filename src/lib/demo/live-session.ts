import "server-only";

import { createClient, type EmailOtpType } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { DEMO_ALEX_EMAIL, DEMO_ALEX_ID } from "@/lib/demo/ids";
import { ensureDemoCircle } from "@/lib/demo/reset";
import { getSupabaseBrowserConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Session } from "@/lib/supabase/session";

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

const CACHE_MS = 10 * 60 * 1000;

let cached: {
  supabase: Session["supabase"];
  expires: number;
} | null = null;

/**
 * An Alex session that lives in this server process, not in the browser.
 * An iframe from another site often cannot store the session cookie.
 * Reads still use Alex's JWT, so the same membership policies apply.
 * The cache is per isolate and is never written to a real user's cookie.
 */
export async function openInMemoryDemoSession(): Promise<Session | null> {
  const ready = await ensureDemoCircle();
  if (!ready.ok) return null;

  if (cached && cached.expires > Date.now()) {
    return { supabase: cached.supabase, userId: DEMO_ALEX_ID };
  }

  const config = getSupabaseBrowserConfig();
  const admin = createAdminClient();
  if (!config || !admin) return null;

  const link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_ALEX_EMAIL,
  });
  const tokenHash = link.data?.properties?.hashed_token;
  const otpType = link.data?.properties?.verification_type;
  if (link.error || !tokenHash || !otpType || !OTP_TYPES.has(otpType)) {
    console.error("Demo sign-in link was not created.");
    return null;
  }

  const supabase = createClient<Database>(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType,
  });
  if (verified.error) {
    console.error("Demo sign-in was not accepted.");
    return null;
  }

  cached = { supabase, expires: Date.now() + CACHE_MS };
  return { supabase, userId: DEMO_ALEX_ID };
}
