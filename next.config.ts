import type { NextConfig } from "next";

import { staticSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Playwright opens the app at 127.0.0.1. The dev server allows localhost
  // only, and without this the sign-in form never hydrates.
  allowedDevOrigins: ["127.0.0.1"],
  // Static files skip the proxy, so they would not otherwise get these.
  // HSTS is omitted here: the proxy sets it on https document responses.
  // A static file served over http must not advertise HSTS.
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
      // Avatar and memory photos are capped at 2 MB. The action body also
      // carries the multipart boundary and the other fields, so the limit
      // sits above 2 MB.
      bodySizeLimit: "3mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
