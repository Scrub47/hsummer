import { Settings } from "lucide-react";
import Link from "next/link";

import { partTwo } from "@/lib/part-two";

export function SettingsGear() {
  return (
    <Link
      href={partTwo.settingsRoute}
      className="icon-button brand-gear"
      aria-label="Settings"
    >
      <Settings aria-hidden="true" size={22} />
    </Link>
  );
}
