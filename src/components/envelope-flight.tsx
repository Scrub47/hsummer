"use client";

import { useSyncExternalStore } from "react";

/**
 * The letter folds, takes a wax seal, and flies off. Opening is the
 * reverse: the envelope arrives, the seal breaks, and the page slides out.
 * `frame` freezes one step for a screenshot. `play` runs the sequence.
 * Reduced motion skips to the last step.
 */

function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type EnvelopeMode = "send" | "open";
export type EnvelopeFrame =
  "play" | "fold" | "seal" | "fly" | "arrive" | "unseal" | "read";

export function EnvelopeFlight({
  mode,
  frame = "play",
  dear = "Dear Summer",
  body,
}: {
  mode: EnvelopeMode;
  frame?: EnvelopeFrame;
  dear?: string;
  body?: string;
}) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    reducedMotion,
    () => false,
  );
  const shown = reduced ? (mode === "send" ? "fly" : "read") : frame;

  return (
    <div
      className="envelope-stage"
      data-mode={mode}
      data-frame={shown}
      data-reduced={reduced ? "true" : "false"}
      aria-hidden={mode === "send"}
    >
      <div className="envelope-letter">
        <p className="font-hand text-2xl">{dear}</p>
        {body ? <p className="letter-body mt-2 text-lg">{body}</p> : null}
      </div>
      <div className="envelope-shell" />
      <div className="envelope-seal" aria-hidden>
        ♥
      </div>
      {mode === "send" ? <div className="envelope-plane" aria-hidden /> : null}
    </div>
  );
}
