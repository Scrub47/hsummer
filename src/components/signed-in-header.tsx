import { BackButton } from "@/components/back-button";
import { BearMark } from "@/components/bear-mark";
import { SettingsGear } from "@/components/settings-gear";
import { TabBar } from "@/components/tab-bar";

/**
 * Wordmark, optional back control, optional settings gear, and the bottom
 * tab bar. The bar itself is portaled to the document root.
 */
export function SignedInHeader({
  current,
  backFallback,
  gear = false,
}: {
  current: "home" | "profile" | "circles";
  backFallback?: string;
  gear?: boolean;
}) {
  return (
    <>
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
