import type { MetadataRoute } from "next";

import {
  icon192,
  icon192Maskable,
  icon512,
  icon512Maskable,
} from "@/lib/brand/icons";

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
        src: icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon192Maskable,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: icon512Maskable,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
