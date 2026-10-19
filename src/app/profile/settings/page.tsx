import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DemoBanner } from "@/components/demo-banner";
import { SettingsFeedback } from "@/components/settings-feedback";
import { SettingsPrivacy } from "@/components/settings-privacy";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadAnalyticsBootstrap } from "@/lib/analytics/bootstrap";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile/settings");

  const analytics = await loadAnalyticsBootstrap();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="profile" />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Privacy and a note for Isaac.
          </p>
        </div>
        {analytics.demo ? <DemoBanner /> : null}
        <SettingsPrivacy optedOut={analytics.optedOut} demo={analytics.demo} />
        {analytics.demo ? null : <SettingsFeedback />}
      </main>
    </div>
  );
}
