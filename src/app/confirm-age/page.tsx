import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConfirmAgeForm } from "@/components/confirm-age-form";
import { safeNextPath } from "@/lib/auth/safe-next";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Confirm your age",
};

export default async function ConfirmAgePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const requested = typeof params.next === "string" ? params.next : null;
  const nextPath = safeNextPath(requested, "https://hsummer.vercel.app");
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);

  const age = await session.supabase
    .from("account_private")
    .select("age_confirmed_at")
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!age.error && age.data?.age_confirmed_at) redirect(nextPath);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 py-10">
      <header>
        <Link href="/" className="font-serif text-xl tracking-tight">
          Hsummer
        </Link>
      </header>
      <main id="content" className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-serif text-4xl tracking-tight">Confirm your age</h1>
        <p className="mt-3 text-base leading-7 text-foreground/80">
          Hsummer is for people 13 and older. This is a confirmation, not a date
          of birth.
        </p>
        <div className="mt-8">
          <ConfirmAgeForm nextPath={nextPath} />
        </div>
      </main>
    </div>
  );
}
