/**
 * Response headers for documents. The proxy sets these on every HTML and
 * API response. Static files get the same set, without the per-request CSP,
 * from next.config.ts.
 *
 * The nonce is how Next attaches its own scripts. `strict-dynamic` lets those
 * scripts load the rest. Styles keep a nonce too; Next stamps the ones it
 * emits. Supabase, web push, and the PWA stay on the allow-list below.
 */

export type CspOptions = {
  nonce: string;
  /** Origin of NEXT_PUBLIC_SUPABASE_URL, or null when it is not configured. */
  supabaseOrigin: string | null;
  turnstile: boolean;
  /** React's dev overlay needs eval. Production must not. */
  development: boolean;
  /** Sends upgrade-insecure-requests. Leave this off for http://127.0.0.1. */
  https: boolean;
};

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function isHttpsRequest(request: {
  url: string;
  headers: { get(name: string): string | null };
}): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'"];
  if (options.development) scriptSrc.push("'unsafe-eval'");
  if (options.turnstile) {
    scriptSrc.push("https://challenges.cloudflare.com");
  }

  const connectSrc = ["'self'"];
  if (options.supabaseOrigin) {
    connectSrc.push(options.supabaseOrigin);
    if (options.supabaseOrigin.startsWith("https://")) {
      connectSrc.push(
        `wss://${options.supabaseOrigin.slice("https://".length)}`,
      );
    } else if (options.supabaseOrigin.startsWith("http://")) {
      connectSrc.push(`ws://${options.supabaseOrigin.slice("http://".length)}`);
    }
  }
  if (options.turnstile) connectSrc.push("https://challenges.cloudflare.com");

  const imgSrc = [
    "'self'",
    "blob:",
    "data:",
    "https://*.supabase.co",
    "https://*.googleusercontent.com",
  ];
  if (
    options.supabaseOrigin &&
    !options.supabaseOrigin.endsWith(".supabase.co")
  ) {
    imgSrc.push(options.supabaseOrigin);
  }

  const frameSrc = options.turnstile
    ? ["https://challenges.cloudflare.com"]
    : ["'none'"];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'nonce-${options.nonce}'`,
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.https) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/** Headers that do not depend on a nonce. Safe on static files too. */
export function staticSecurityHeaders(https: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
  };
  if (https) {
    // Two years. includeSubDomains covers a future app. subdomain of this
    // host, not of vercel.app. Preload is intentionally absent: sending it
    // is a promise to submit the host to the browser preload list.
    headers["Strict-Transport-Security"] =
      "max-age=63072000; includeSubDomains";
  }
  return headers;
}

export function applyDocumentSecurity(
  headers: { set(name: string, value: string): void },
  input: { csp: string; https: boolean },
): void {
  headers.set("Content-Security-Policy", input.csp);
  for (const [name, value] of Object.entries(
    staticSecurityHeaders(input.https),
  )) {
    headers.set(name, value);
  }
}
