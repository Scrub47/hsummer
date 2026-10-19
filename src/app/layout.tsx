import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { FeedbackPrompt } from "@/components/feedback-prompt";
import { OfflineBanner } from "@/components/offline-banner";
import { ProductAnalytics } from "@/components/product-analytics";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { SiteFooter } from "@/components/site-footer";
import { ToastHost } from "@/components/toast-host";
import { loadAnalyticsBootstrap } from "@/lib/analytics/bootstrap";
import { getSiteUrl } from "@/lib/env";

import "./globals.css";

const nunito = localFont({
  src: [
    { path: "../fonts/nunito-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/nunito-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/nunito-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-nunito",
  display: "swap",
});

const caveat = localFont({
  src: [
    { path: "../fonts/caveat-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/caveat-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-caveat",
  display: "swap",
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
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#3a1824" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nonce-based CSP is per request. Waiting for the request keeps every page
  // dynamic so Next can stamp that nonce on its scripts.
  await connection();
  const analytics = await loadAnalyticsBootstrap();

  return (
    <html
      lang="en"
      className={`${nunito.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <Analytics />
        <SpeedInsights />
        <ProductAnalytics
          userId={analytics.userId}
          optedOut={analytics.optedOut}
          preferenceKnown={analytics.preferenceKnown}
          demo={analytics.demo}
        />
        {analytics.prompt ? <FeedbackPrompt /> : null}
        <ServiceWorkerRegister />
        <OfflineBanner />
        <div id="content">{children}</div>
        <SiteFooter />
        <ToastHost />
      </body>
    </html>
  );
}
