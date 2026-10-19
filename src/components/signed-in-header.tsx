import { BackButton } from "@/components/back-button";
import { BearMark } from "@/components/bear-mark";
import { SettingsGear } from "@/components/settings-gear";
import { SoundSync } from "@/components/sound-sync";
import { TabBar } from "@/components/tab-bar";
import { loadOwnSettings } from "@/lib/settings/load";
import { getSession } from "@/lib/supabase/session";

/**
 * Wordmark, optional back control, optional settings gear, and the bottom
 * tab bar. The bar itself is portaled to the document root.
 */
export async function SignedInHeader({
  current,
  backFallback,
  gear = false,
}: {
  current: "home" | "profile" | "circles";
  backFallback?: string;
  gear?: boolean;
}) {
  const session = await getSession();
  const sounds = session
    ? (await loadOwnSettings(session)).prefs.sounds
    : false;

  return (
    <>
      <SoundSync on={sounds} />
      <div className="brand-row">
        {backFallback ? <BackButton fallback={backFallback} /> : null}
        <BearMark size={36} alt="" />
        <span className="font-hand text-2xl leading-none">Hsummer</span>
        {gear ? <SettingsGear /> : null}
      </div>
      <TabBar current={current} />
    </>
  );
}
