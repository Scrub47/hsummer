"use client";

import { useEffect } from "react";

import { BearMark } from "@/components/bear-mark";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const message = error.message.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!message) return;
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        path: window.location.pathname,
      }),
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 py-16">
      <BearMark size={96} alt="" />
      <h1 className="mt-4 text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        This page didn&apos;t finish loading. Try it again.
      </p>
      <button type="button" onClick={reset} className="btn mt-6">
        Try again
      </button>
    </div>
  );
}
