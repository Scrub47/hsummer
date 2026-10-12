import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stay off. Signed-in pages read the session cookie on
  // every request, and week 1 has no public data worth caching. Turn this
  // on later for pages that can render a static shell.
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
