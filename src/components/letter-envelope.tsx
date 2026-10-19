"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { envelopeMs } from "@/lib/letters/envelope";

function emptySubscribe() {
  return () => {};
}

function stageRoot() {
  return document.getElementById("letter-stage-root");
}

function serverStageRoot() {
  return null;
}

function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedNow() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function reducedOnServer() {
  return false;
}

/** Whether this device asked for less motion, and how long the envelope runs. */
export function useEnvelopeMotion() {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    reducedNow,
    reducedOnServer,
  );
  return { reduced, ms: envelopeMs(reduced) };
}

/**
 * The envelope plays outside the letter list. A `<details>` panel and a
 * disabled button both drop CSS animation in iOS standalone. The stage is a
 * direct child of body, then pinned to the visual viewport.
 */
export function LetterEnvelope({
  scene,
  reduced,
  holdAt = null,
}: {
  scene: "send" | "open";
  reduced?: boolean;
  holdAt?: number | null;
}) {
  const detected = useEnvelopeMotion();
  const isReduced = reduced ?? detected.reduced;
  const stageRef = useRef<HTMLDivElement>(null);
  const root = useSyncExternalStore(emptySubscribe, stageRoot, serverStageRoot);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;

    function pin() {
      const el = stageRef.current;
      const viewport = window.visualViewport;
      if (!el || !viewport) return;
      el.style.top = `${Math.round(viewport.offsetTop)}px`;
      el.style.left = `${Math.round(viewport.offsetLeft)}px`;
      el.style.width = `${Math.round(viewport.width)}px`;
      el.style.height = `${Math.round(viewport.height)}px`;
    }

    pin();
    const viewport = window.visualViewport;
    viewport?.addEventListener("scroll", pin);
    viewport?.addEventListener("resize", pin);
    window.addEventListener("scroll", pin, { passive: true });
    window.addEventListener("orientationchange", pin);
    return () => {
      viewport?.removeEventListener("scroll", pin);
      viewport?.removeEventListener("resize", pin);
      window.removeEventListener("scroll", pin);
      window.removeEventListener("orientationchange", pin);
    };
  }, [root]);

  if (!root) return null;

  const label = scene === "send" ? "Sending your letter" : "Opening the letter";
  const held = holdAt != null;

  return createPortal(
    <div
      ref={stageRef}
      className="letter-envelope letter-envelope-stage"
      data-testid="letter-envelope"
      data-scene={scene}
      data-motion={isReduced ? "reduced" : "full"}
      data-hold={held ? "" : undefined}
      role="status"
      aria-label={label}
      style={{
        ["--envelope-ms" as string]: `${envelopeMs(isReduced)}ms`,
        ["--envelope-hold" as string]: held ? `-${holdAt}ms` : "0ms",
      }}
    >
      <div className="letter-envelope-flight" aria-hidden="true">
        <div className="letter-envelope-sheet" />
        <div className="letter-envelope-pocket" />
        <div className="letter-envelope-flap" />
        <div className="letter-envelope-seal" />
      </div>
    </div>,
    root,
  );
}
