"use client";

import { useEffect } from "react";

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
      <h1 className="font-serif text-4xl tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-4 text-base leading-7 text-foreground/80">
        This page didn&apos;t finish loading. Try it again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex h-12 w-fit items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink"
      >
        Try again
      </button>
    </div>
  );
}
