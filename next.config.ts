import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stay off. Signed-in pages read the session cookie on
  // every request, and there is no public data worth caching yet. Turn this
  // on later for pages that can render a static shell.
  experimental: {
    serverActions: {
      // Avatar uploads are capped at 2 MB. The action body also carries the
      // multipart boundary and the other fields, so the limit sits above 2 MB.
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
