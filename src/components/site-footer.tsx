"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const path = usePathname();
  const inApp =
    path.startsWith("/home") ||
    path.startsWith("/circles") ||
    path.startsWith("/profile") ||
    path.startsWith("/preview");
  if (inApp) return null;

  return (
    <footer className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
      <p>© 2026 Isaac Hsu. All rights reserved.</p>
      <nav className="flex gap-4">
        <Link href="/privacy" className="underline">
          Privacy
        </Link>
        <Link href="/terms" className="underline">
          Terms
        </Link>
      </nav>
    </footer>
  );
}
