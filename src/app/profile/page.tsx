import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Link from "next/link";

import { DemoBanner } from "@/components/demo-banner";
import { ProfileForm } from "@/components/profile-form";
import { RefreshSignedUrls } from "@/components/refresh-signed-urls";
import { SignedInHeader } from "@/components/signed-in-header";
import { AVATAR_SIGNED_URL_SECONDS } from "@/lib/profile/fields";
import { loadAccountFlags } from "@/lib/account/load";
import { loadOwnProfile } from "@/lib/profile/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [profile, account] = await Promise.all([
    loadOwnProfile(session),
    loadAccountFlags(session),
  ]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <RefreshSignedUrls
        enabled={Boolean(profile?.avatarUrl)}
        seconds={AVATAR_SIGNED_URL_SECONDS}
      />
      <SignedInHeader current="profile" gear />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            People in your circle see this name, photo, and time zone.
          </p>
        </div>
        {account.isDemo ? <DemoBanner /> : null}
        {profile && !account.isDemo ? (
          <ProfileForm
            displayName={profile.displayName}
            timezone={profile.timezone}
            avatarUrl={profile.avatarUrl}
            hasAvatar={profile.hasAvatar}
          />
        ) : profile ? (
          <p className="max-w-xl text-base leading-7">
            {profile.displayName}. Timezone {profile.timezone}. This demo
            profile cannot be edited.
          </p>
        ) : (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            You&apos;re signed in, but there is no profile row yet. Apply the
            migrations in <code>supabase/migrations</code> so signup creates
            one.
          </p>
        )}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Account</h2>
          <Link href="/profile/settings" className="btn w-fit">
            Settings
          </Link>
          <p className="max-w-xl text-sm leading-6 text-muted">
            Notifications, quiet hours, time zone, theme, and privacy.
          </p>
          <nav className="flex gap-4 text-sm font-bold">
            <Link href="/profile/settings" className="underline">
              Settings
            </Link>
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            <Link href="/terms" className="underline">
              Terms
            </Link>
          </nav>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="btn-quiet">
              Sign out
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
