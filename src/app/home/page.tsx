import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InstallHint } from "@/components/install-hint";
import { ProfileAvatar } from "@/components/profile-avatar";
import { PushPanel } from "@/components/push-panel";
import { SignedInHeader } from "@/components/signed-in-header";
import { loadOwnProfile } from "@/lib/profile/load";
import { getSession } from "@/lib/supabase/session";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const profile = await loadOwnProfile(session);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
      <SignedInHeader current="home" />
      <main className="flex flex-1 flex-col gap-10 py-16">
        <div>
          <div className="flex items-center gap-5">
            {profile ? (
              <ProfileAvatar
                name={profile.displayName}
                url={profile.avatarUrl}
                alt=""
                className="h-16 w-16 text-xl"
              />
            ) : null}
            <h1 className="font-serif text-5xl tracking-tight">
              {profile?.displayName
                ? `Hello, ${profile.displayName}`
                : "You're in"}
            </h1>
          </div>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground/80">
            This is a placeholder home. Circles, letters, and the bucket list
            come in later weeks. For now, you can subscribe this device and send
            yourself a test notification.
          </p>
          {profile ? (
            <p className="mt-4 text-sm text-foreground/70">
              Timezone: {profile.timezone}
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-foreground/70">
              You&apos;re signed in, but there is no profile row yet. Apply the
              migrations in <code>supabase/migrations</code> so signup creates
              one. Your email stays in Supabase Auth — it is not stored on the
              profile.
            </p>
          )}
        </div>
        <InstallHint />
        <PushPanel />
      </main>
    </div>
  );
}
