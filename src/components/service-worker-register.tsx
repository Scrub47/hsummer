"use client";

import { useEffect } from "react";

/**
 * Registers the push service worker for the whole origin.
 * Registration is not a permission prompt; subscribing still requires a tap.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Insecure origins other than localhost cannot register a worker.
    });
  }, []);

  return null;
}
