import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";

import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { getSiteUrl } from "@/lib/env";

import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: {
    default: "Hsummer",
    template: "%s · Hsummer",
  },
  description:
    "A private shared space for couples, friends, and families who are far apart.",
  applicationName: "Hsummer",
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  appleWebApp: {
    capable: true,
    title: "Hsummer",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f3ecdf",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
