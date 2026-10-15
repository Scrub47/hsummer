import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  isHttpsRequest,
  staticSecurityHeaders,
} from "@/lib/security/headers";

const nonce = "nonce-value";

describe("content security policy", () => {
  it("uses a nonce, blocks frames, and names the Supabase origin", () => {
    const csp = buildContentSecurityPolicy({
      nonce,
      supabaseOrigin: "https://abcd.supabase.co",
      turnstile: false,
      development: false,
      https: true,
    });

    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("https://abcd.supabase.co");
    expect(csp).toContain("wss://abcd.supabase.co");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("img-src 'self' blob:");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-src 'none'");
  });

  it("allows the dev overlay and Turnstile only when those are on", () => {
    const csp = buildContentSecurityPolicy({
      nonce,
      supabaseOrigin: "http://127.0.0.1:54321",
      turnstile: true,
      development: true,
      https: false,
    });

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("ws://127.0.0.1:54321");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("static security headers", () => {
  it("sets HSTS only on https", () => {
    expect(staticSecurityHeaders(false)["Strict-Transport-Security"]).toBe(
      undefined,
    );
    expect(staticSecurityHeaders(true)["Strict-Transport-Security"]).toContain(
      "max-age=63072000",
    );
    expect(staticSecurityHeaders(true)["X-Content-Type-Options"]).toBe(
      "nosniff",
    );
    expect(staticSecurityHeaders(true)["Permissions-Policy"]).toContain(
      "camera=(self)",
    );
    expect(staticSecurityHeaders(true)["Permissions-Policy"]).toContain(
      "microphone=()",
    );
    expect(staticSecurityHeaders(true)["Permissions-Policy"]).not.toContain(
      "camera=()",
    );
    expect(
      isHttpsRequest({
        url: "http://localhost:3000/",
        headers: {
          get: (name) => (name === "x-forwarded-proto" ? "https" : null),
        },
      }),
    ).toBe(true);
  });
});
