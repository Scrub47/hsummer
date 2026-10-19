import Link from "next/link";
import { House, UserRound, Users } from "lucide-react";

const tabs = [
  { href: "/home", id: "home", label: "Home", icon: House },
  { href: "/circles", id: "circles", label: "Circle", icon: Users },
  { href: "/profile", id: "profile", label: "Profile", icon: UserRound },
] as const;

export function TabBar({
  current,
}: {
  current: "home" | "profile" | "circles";
}) {
  return (
    <nav className="tab-bar" aria-label="Primary">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = current === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={20} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
