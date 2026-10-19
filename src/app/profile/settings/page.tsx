import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DeleteAccountForm } from "@/components/delete-account-form";
import { DemoBanner } from "@/components/demo-banner";
import { ExportButton } from "@/components/export-button";
import { LeaveCircleForm } from "@/components/leave-circle-form";
import { PushPanel } from "@/components/push-panel";
import { SettingsFeedback } from "@/components/settings-feedback";
import { SettingsPanel } from "@/components/settings-panel";
import { SettingsPrivacy } from "@/components/settings-privacy";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadAccountFlags } from "@/lib/account/load";
import { loadAnalyticsBootstrap } from "@/lib/analytics/bootstrap";
import { loadCircles } from "@/lib/circles/load";
import { loadOwnProfile } from "@/lib/profile/load";
import { firstName } from "@/lib/profile/first-name";
import { loadOwnSettings } from "@/lib/settings/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile/settings");

  const [settings, profile, account, circles, analytics] = await Promise.all([
    loadOwnSettings(session),
    loadOwnProfile(session),
    loadAccountFlags(session),
    loadCircles(session),
    loadAnalyticsBootstrap(),
  ]);
  const demo = account.isDemo || analytics.demo;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="profile" backFallback="/profile" gear />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        {demo ? <DemoBanner /> : <PushPanel />}
        {demo ? (
          <p className="text-sm text-muted">
            This demo account can&apos;t change settings.
          </p>
        ) : (
          <SettingsPanel
            prefs={settings.prefs}
            timezone={settings.timezone}
            exampleName={firstName(profile?.displayName ?? "") || "Summer"}
          />
        )}
        <SettingsPrivacy optedOut={analytics.optedOut} demo={demo} />
        {demo ? null : <SettingsFeedback />}
        <section className="flex flex-col gap-4" aria-labelledby="data-heading">
          <h2 id="data-heading" className="text-lg font-bold">
            Your data
          </h2>
          <p className="text-sm leading-6 text-muted">
            Your copy of what you can see, leaving a circle, and deleting the
            account.
          </p>
          {demo ? null : <ExportButton />}
          {circles.circles
            .filter((circle) => circle.status !== "archived")
            .map((circle) => (
              <LeaveCircleForm key={circle.id} circleId={circle.id} />
            ))}
          {demo ? null : <DeleteAccountForm />}
          <nav className="flex gap-4 text-sm font-bold">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </section>
      </main>
    </div>
  );
}
