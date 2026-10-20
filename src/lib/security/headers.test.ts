import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  documentPolicyHeaders,
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
    const framed = buildContentSecurityPolicy({
      nonce,
      supabaseOrigin: null,
      turnstile: false,
      development: false,
      https: true,
      frameAncestors: "'self' https://portfolio-isaac-hsu.vercel.app",
    });
    expect(framed).toContain(
      "frame-ancestors 'self' https://portfolio-isaac-hsu.vercel.app",
    );
    expect(framed).not.toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://va.vercel-scripts.com");
    expect(csp).toContain("https://vitals.vercel-insights.com");
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
    expect(staticSecurityHeaders(true)["X-Frame-Options"]).toBeUndefined();
    expect(staticSecurityHeaders(true)["Permissions-Policy"]).toBeUndefined();

    const locked = documentPolicyHeaders({ https: true, demoFrame: false });
    expect(locked["X-Frame-Options"]).toBe("DENY");
    expect(locked["Permissions-Policy"]).toMatch(/^camera=\(self\),/);
    expect(locked["Permissions-Policy"]).toContain("microphone=()");

    const demo = documentPolicyHeaders({ https: true, demoFrame: true });
    expect(demo["X-Frame-Options"]).toBeUndefined();
    expect(demo["Permissions-Policy"]).toMatch(/^camera=\(\),/);
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
