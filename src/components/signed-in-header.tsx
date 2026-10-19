import { BearMark } from "@/components/bear-mark";
import { TabBar } from "@/components/tab-bar";

/**
 * A small wordmark and the bottom tab bar. Sign out lives on Profile.
 */
export function SignedInHeader({
  current,
}: {
  current: "home" | "profile" | "circles";
}) {
  return (
    <>
      <div className="brand-row">
        <BearMark size={36} alt="" />
        <span className="font-hand text-2xl leading-none">Hsummer</span>
      </div>
      <TabBar current={current} />
    </>
  );
}
