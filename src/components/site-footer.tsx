import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-8 text-sm text-foreground/70 sm:flex-row sm:items-center sm:justify-between">
      <p>© 2026 Isaac Hsu. All rights reserved.</p>
      <nav className="flex gap-4">
        <Link href="/privacy" className="underline decoration-pine/40">
          Privacy
        </Link>
        <Link href="/terms" className="underline decoration-pine/40">
          Terms
        </Link>
      </nav>
    </footer>
  );
}
