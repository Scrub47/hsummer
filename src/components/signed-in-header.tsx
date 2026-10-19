import { BearMark } from "@/components/bear-mark";
import { SoundSync } from "@/components/sound-sync";
import { TabBar } from "@/components/tab-bar";
import { loadOwnSettings } from "@/lib/settings/load";
import { getSession } from "@/lib/supabase/session";

/**
 * A small wordmark and the bottom tab bar. Sign out lives on Profile.
 */
export async function SignedInHeader({
  current,
}: {
  current: "home" | "profile" | "circles";
}) {
  const session = await getSession();
  const sounds = session
    ? (await loadOwnSettings(session)).prefs.sounds
    : false;

  return (
    <>
      <SoundSync on={sounds} />
      <div className="brand-row">
        <BearMark size={36} alt="" />
        <span className="font-hand text-2xl leading-none">Hsummer</span>
      </div>
      <TabBar current={current} />
    </>
  );
}
