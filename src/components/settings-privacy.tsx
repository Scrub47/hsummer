"use client";

import { useState } from "react";

import { setAnalyticsOptOut } from "@/app/profile/settings/actions";
import { applyAnalyticsOptOut } from "@/lib/analytics/client";

/**
 * Settings → Privacy. The switch calls PostHog in this tab immediately,
 * then stores the same choice on the account.
 */
export function SettingsPrivacy({
  optedOut,
  demo,
}: {
  optedOut: boolean;
  demo: boolean;
}) {
  const [off, setOff] = useState(optedOut);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (demo || pending) return;
    const next = !off;
    setOff(next);
    setError(null);
    applyAnalyticsOptOut(next);
    setPending(true);
    const result = await setAnalyticsOptOut(next);
    setPending(false);
    if (result.error) {
      setOff(!next);
      applyAnalyticsOptOut(!next);
      setError(result.error);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="text-xl font-bold">
        Privacy
      </h2>
      <p className="max-w-xl text-sm leading-6 text-foreground/80">
        Usage numbers count visits and a short list of actions, such as a letter
        being sent. They do not include letter text, names, photos, or your
        email. Turning this off stops that counting on this device right away.
      </p>
      {demo ? (
        <p className="text-sm leading-6 text-foreground/70">
          The demo does not send usage numbers.
        </p>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={off}
          disabled={pending}
          onClick={() => void toggle()}
          className="switch"
        >
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span>Opt out of usage numbers</span>
        </button>
      )}
      {error ? (
        <p className="text-sm text-accent" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
