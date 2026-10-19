"use client";

import { useState } from "react";

/**
 * Downloads the signed-in person's ZIP. A small archive comes back as the
 * file. A larger one comes back as a short-lived link to the private bucket.
 */
export function ExportButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/export", { method: "POST" });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "The download couldn't be built.");
        return;
      }
      if (type.includes("application/zip")) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "hsummer-export.zip";
        link.click();
        URL.revokeObjectURL(url);
        return;
      }
      const body = (await response.json()) as { url?: string };
      if (!body.url) {
        setError("The download couldn't be built.");
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("The download couldn't be built.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-pine px-5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Download my data"}
      </button>
      {error ? (
        <p className="text-sm leading-6" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
