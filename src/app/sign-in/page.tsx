import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/safe-next";
import { BearMark } from "@/components/bear-mark";
import { InfoTip } from "@/components/info-tip";
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
        <Link href="/" className="inline-flex items-center gap-2">
          <BearMark size={36} alt="" />
          <span className="font-hand text-2xl leading-none">Hsummer</span>
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center py-8">
        <div className="flex items-center gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <InfoTip label="How sign-in works">
            Use Google, or get a magic link by email. There is no password to
            store.
          </InfoTip>
        </div>
        <div className="mt-8">
          <SignInForm errorCode={errorCode} nextPath={nextPath} />
        </div>
        <p className="mt-8 text-sm leading-6 text-foreground/80">
          Looking around first?{" "}
          <Link href="/demo" className="font-bold text-pine">
            Try the demo
          </Link>
          . It is a fictional couple, and it does not need Google.
        </p>
      </main>
    </div>
  );
}
