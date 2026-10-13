import Link from "next/link";

export function SignedInHeader({ current }: { current: "home" | "profile" }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Link href="/" className="font-serif text-xl tracking-tight">
        Hsummer
      </Link>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <HeaderLink href="/home" current={current === "home"}>
          Home
        </HeaderLink>
        <HeaderLink href="/profile" current={current === "profile"}>
          Profile
        </HeaderLink>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="text-sm font-medium text-pine underline decoration-pine/40"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}

function HeaderLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={
        current
          ? "text-sm font-medium"
          : "text-sm font-medium text-pine underline decoration-pine/40"
      }
    >
      {children}
    </Link>
  );
}
