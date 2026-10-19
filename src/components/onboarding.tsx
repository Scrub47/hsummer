"use client";

import { useState, useSyncExternalStore } from "react";

import { BearMark } from "@/components/bear-mark";

const KEY = "hsummer-onboarded-v1";

const steps = [
  {
    title: "This is your space.",
    body: "Hsummer, made for couples, built for groups, friends, and families.",
  },
  {
    title: "Three places.",
    body: "Home is your person. Circle holds what you share. Profile is you.",
  },
  {
    title: "Pings can reach a lock screen.",
    body: "We'll explain that again before the browser asks to send notifications.",
  },
];

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function Onboarding() {
  const seen = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(KEY) === "1",
    () => true,
  );
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  if (seen || dismissed) return null;

  const current = steps[step] ?? steps[0]!;
  const last = step >= steps.length - 1;

  function finish() {
    window.localStorage.setItem(KEY, "1");
    setDismissed(true);
  }

  return (
    <section className="onboarding" aria-label="Welcome">
      <BearMark size={88} alt="" />
      <h2 className="font-hand text-3xl">{current.title}</h2>
      <p className="text-sm leading-6">{current.body}</p>
      <div className="flex gap-2">
        {last ? (
          <button type="button" className="btn" onClick={finish}>
            Got it
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => setStep((value) => value + 1)}
          >
            Next
          </button>
        )}
        <button type="button" className="btn-quiet" onClick={finish}>
          Skip
        </button>
      </div>
    </section>
  );
}
