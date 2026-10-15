import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DeleteAccountForm } from "@/components/delete-account-form";
import { DemoBanner } from "@/components/demo-banner";
import { ExportButton } from "@/components/export-button";
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
      <SignedInHeader current="profile" />
      <main className="flex flex-1 flex-col gap-8 py-16">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">Your profile</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
            People who share a circle with you will see this name, photo, and
            timezone. Your email stays in sign-in and is not part of this
            profile.
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
        {account.isDemo ? null : (
          <section className="flex flex-col gap-4">
            <h2 className="font-serif text-2xl tracking-tight">Your data</h2>
            <p className="max-w-xl text-sm leading-6 text-foreground/80">
              A ZIP of the profile, circles, letters, and photos you can already
              see. It is not a backup of anyone else&apos;s private letters, and
              it is not the weekly database backup.
            </p>
            <ExportButton />
          </section>
        )}
        {account.isDemo ? null : <DeleteAccountForm />}
      </main>
    </div>
  );
}
