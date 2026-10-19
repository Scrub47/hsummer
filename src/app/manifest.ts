import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hsummer",
    short_name: "Hsummer",
    description: "Made for couples, built for groups, friends, and families.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#f7f0e8",
    theme_color: "#f7f0e8",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
