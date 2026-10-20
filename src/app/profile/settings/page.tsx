import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { PushPanel } from "@/components/push-panel";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadAccountFlags } from "@/lib/account/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile/settings");

  const account = await loadAccountFlags(session);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="profile" backFallback="/profile" />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        {account.isDemo ? <DemoBanner /> : <PushPanel />}
      </main>
    </div>
  );
}
