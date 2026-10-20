import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CircleScreen } from "@/components/circle-screen";
import { DEMO_ALEX_ID, DEMO_CIRCLE_ID } from "@/lib/demo/ids";
import { createDemoFixtureSession } from "@/lib/demo/fixture";
import { openInMemoryDemoSession } from "@/lib/demo/live-session";
import { demoDocumentOrigin, demoPreviewEnabled } from "@/lib/demo/preview";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Demo",
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{
    embed?: string | string[];
    signedin?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const headerList = await headers();
  const embed =
    headerList.get("sec-fetch-dest") === "iframe" || params.embed === "1";

  if (demoPreviewEnabled()) {
    const session =
      (await getSession()) ??
      createDemoFixtureSession(await demoDocumentOrigin());
    return <CircleScreen session={session} circleId={DEMO_CIRCLE_ID} />;
  }

  const session = await getSession();
  if (session && session.userId !== DEMO_ALEX_ID) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Try the demo</h1>
        <p className="text-base leading-7">
          You&apos;re signed in with your own account. Sign out before opening
          the sample circle, so the demo stays separate from your data.
        </p>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
        <Link href="/home" className="text-sm font-bold text-pine">
          Back to your circles
        </Link>
      </div>
    );
  }

  if (session && !embed) {
    return <CircleScreen session={session} circleId={DEMO_CIRCLE_ID} />;
  }

  if (embed) {
    const demo = await openInMemoryDemoSession();
    if (!demo) {
      return (
        <p className="mx-auto max-w-md px-6 py-16 text-sm leading-6">
          The demo circle isn&apos;t ready yet.
        </p>
      );
    }
    return <CircleScreen session={demo} circleId={DEMO_CIRCLE_ID} />;
  }

  redirect("/api/demo/enter");
}
