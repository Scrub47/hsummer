import "server-only";

/**
 * Checks a Turnstile token with Cloudflare. Used for Google sign-in only.
 * Magic link leaves the token for Supabase, which checks `/otp`.
 */
export async function verifyTurnstile(input: {
  token: string;
  secret: string;
  remoteIp: string | null;
}): Promise<boolean> {
  const body = new URLSearchParams({
    secret: input.secret,
    response: input.token,
  });
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!response.ok) return false;
    return turnstileAccepted(await response.json());
  } catch {
    console.error("Turnstile verification did not answer.");
    return false;
  }
}

export function turnstileAccepted(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { success?: unknown }).success === true;
}
