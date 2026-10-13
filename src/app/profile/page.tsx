import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile-form";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadOwnProfile } from "@/lib/profile/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const profile = await loadOwnProfile(session);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
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
        {profile ? (
          <ProfileForm
            displayName={profile.displayName}
            timezone={profile.timezone}
            avatarUrl={profile.avatarUrl}
            hasAvatar={profile.hasAvatar}
          />
        ) : (
          <p className="max-w-xl text-sm leading-6 text-foreground/70">
            You&apos;re signed in, but there is no profile row yet. Apply the
            migrations in <code>supabase/migrations</code> so signup creates
            one.
          </p>
        )}
      </main>
    </div>
  );
}
