"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { backTarget } from "@/lib/chrome/back";

/**
 * Goes back through history. With no history, a feature hash returns to the
 * circle home and every other screen uses its parent route.
 */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();

  function goBack() {
    const target = backTarget({
      historyLength: window.history.length,
      hash: window.location.hash,
      pathname: window.location.pathname,
      search: window.location.search,
      fallback,
    });
    if (target.kind === "back") {
      router.back();
      return;
    }
    router.replace(target.href);
  }

  return (
    <button
      type="button"
      className="icon-button"
      aria-label="Back"
      onClick={goBack}
    >
      <ChevronLeft aria-hidden="true" size={22} />
    </button>
  );
}
