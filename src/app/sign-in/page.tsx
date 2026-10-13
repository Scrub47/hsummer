import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/safe-next";
import { SignInForm } from "@/components/sign-in-form";
import { getUserId } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const requestedNext = typeof params.next === "string" ? params.next : null;
  const nextPath = safeNextPath(requestedNext, "https://hsummer.vercel.app");

  const userId = await getUserId();
  if (userId) redirect(nextPath);

  const errorCode = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 py-10">
      <header>
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-4xl tracking-tight">Sign in</h1>
        <p className="mt-3 text-base leading-7 text-foreground/80">
          Use Google, or get a magic link by email. There is no password to
          store.
        </p>
        <div className="mt-8">
          <SignInForm errorCode={errorCode} nextPath={nextPath} />
        </div>
      </main>
    </div>
  );
}
