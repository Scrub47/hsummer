import type { NextConfig } from "next";

import {
  posthogKeyConfigured,
  posthogRewrites,
} from "./src/lib/analytics/hosts";
import { staticSecurityHeaders } from "./src/lib/security/headers";

const posthogBrowser = posthogKeyConfigured(process.env.NEXT_PUBLIC_POSTHOG_KEY)
  ? "./src/lib/analytics/posthog-browser.ts"
  : "./src/lib/analytics/posthog-browser-stub.ts";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev indicator is an unstyled gray button. It is not part of the app,
  // and it was landing in the phone screenshots.
  devIndicators: false,
  // Playwright opens the app at 127.0.0.1. The dev server allows localhost
  // only, and without this the sign-in form never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
  // Static files skip the proxy, so they would not otherwise get these.
  // HSTS is omitted here: the proxy sets it on https document responses.
  // A static file served over http must not advertise HSTS.
  // PostHog posts to /ingest/e and /ingest/e/. A trailing-slash redirect
  // would drop the one with the slash before the rewrite can proxy it.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogRewrites(process.env.NEXT_PUBLIC_POSTHOG_HOST);
  },
  async headers() {
    const security = staticSecurityHeaders(false);
    return [
      {
        source: "/:path*",
        headers: Object.entries(security).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
  // Cache Components stay off. Signed-in pages read the session cookie on
  // every request, and there is no public data worth caching yet. Turn this
  // on later for pages that can render a static shell.
  experimental: {
    serverActions: {
      // A memory photo is capped at 2 MB. A Solo strip sends up to four
      // slot JPEGs. The limit stays under Vercel's 4.5 MB request cap.
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    // An empty or placeholder key resolves the browser module to a stub, so
    // posthog-js is not in the client bundle until a real key is set.
    resolveAlias: {
      "@/lib/analytics/posthog-browser": posthogBrowser,
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
