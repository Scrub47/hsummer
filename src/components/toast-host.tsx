"use client";

import { useEffect, useState } from "react";

export function pushToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("hsummer-toast", { detail: message }));
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer = 0;
    function onToast(event: Event) {
      const text = (event as CustomEvent<string>).detail;
      if (!text) return;
      setMessage(text);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 2400);
    }
    window.addEventListener("hsummer-toast", onToast);
    return () => {
      window.removeEventListener("hsummer-toast", onToast);
      window.clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
