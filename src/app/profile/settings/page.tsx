import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { PushPanel } from "@/components/push-panel";
import { SettingsFeedback } from "@/components/settings-feedback";
import { SettingsPrivacy } from "@/components/settings-privacy";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadAccountFlags } from "@/lib/account/load";
import { loadAnalyticsBootstrap } from "@/lib/analytics/bootstrap";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile/settings");

  const [account, analytics] = await Promise.all([
    loadAccountFlags(session),
    loadAnalyticsBootstrap(),
  ]);
  const demo = account.isDemo || analytics.demo;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="profile" backFallback="/profile" gear />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        {demo ? <DemoBanner /> : <PushPanel />}
        <SettingsPrivacy optedOut={analytics.optedOut} demo={demo} />
        {demo ? null : <SettingsFeedback />}
      </main>
    </div>
  );
}
