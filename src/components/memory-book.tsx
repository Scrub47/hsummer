"use client";

import { useState } from "react";

import { trackProductEvent } from "@/lib/analytics/client";
import type { MemoryCard } from "@/lib/memories/group";

/**
 * A printable keepsake of the memories this person already chose.
 * The PDF download is the file. Print uses this page.
 */
export function MemoryBook({
  circleId,
  memories,
}: {
  circleId: string;
  memories: MemoryCard[];
}) {
  const [picked, setPicked] = useState<string[]>(
    memories.slice(0, 8).map((memory) => memory.id),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const selected = memories.filter((memory) => picked.includes(memory.id));

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function download() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/keepsake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ circleId, ids: picked }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "The book couldn't be built.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "hsummer-memory-book.pdf";
      link.click();
      URL.revokeObjectURL(url);
      trackProductEvent("keepsake_exported");
    } catch {
      setError("The book couldn't be built.");
    } finally {
      setPending(false);
    }
  }

  if (memories.length === 0) {
    return <p className="text-sm text-muted">Nothing to put in a book yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2 print:hidden">
        {memories.map((memory) => (
          <li key={memory.id}>
            <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.includes(memory.id)}
                onChange={() => toggle(memory.id)}
              />
              <span>
                <span className="block font-bold">{memory.author}</span>
                <span className="block text-sm text-muted">
                  {memory.body?.trim() ||
                    (memory.kind === "photo-strip"
                      ? "Photo strip"
                      : memory.kind)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="text-sm text-accent" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          className="btn"
          disabled={pending || picked.length === 0}
          onClick={() => void download()}
        >
          {pending ? "Making the PDF…" : "Download PDF"}
        </button>
        <button
          type="button"
          className="btn-quiet"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>
      <article
        className="book-sheet flex flex-col gap-6"
        aria-label="Printable book"
      >
        <h2 className="font-hand text-4xl">For us</h2>
        {selected.map((memory) => (
          <section key={memory.id} className="border-t border-line pt-4">
            <p className="text-sm font-bold text-pine">{memory.author}</p>
            <p className="text-sm text-muted">{memory.occurredOn}</p>
            {memory.body ? (
              <p className="letter-body mt-2 whitespace-pre-wrap">
                {memory.body}
              </p>
            ) : (
              <p className="mt-2 text-sm">
                {memory.kind === "photo-strip"
                  ? "A photo booth strip."
                  : "A photo."}
              </p>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}
