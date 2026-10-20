"use client";

import { useActionState, useEffect, useSyncExternalStore } from "react";

import {
  saveSettings,
  type SettingsState,
} from "@/app/profile/settings/actions";
import { rememberSounds } from "@/lib/feel/feedback";
import { supportedTimeZones } from "@/lib/profile/fields";
import {
  formatResumeLabel,
  type NotificationPrefs,
} from "@/lib/settings/prefs";
import { friendlyZoneLabel } from "@/lib/time/zones";

const initial: SettingsState = { error: null, saved: false };

function subscribe() {
  return () => {};
}

const TOGGLES: {
  name: keyof NotificationPrefs;
  label: string;
  detail: string;
}[] = [
  { name: "pings", label: "Pings", detail: "Thinking of You" },
  { name: "letters", label: "Letters", detail: "When one arrives" },
  { name: "booth", label: "Booth turns", detail: "When it's your turn" },
  { name: "stillUs", label: "Still Us", detail: "A checkpoint is hit" },
  {
    name: "group",
    label: "Group activity",
    detail: "Circles with more than two people",
  },
];

/**
 * Which updates to send, quiet hours, time zone, theme, and sounds.
 * Device push lives in the Notifications panel above this form.
 * Privacy (export, leave, delete) is rendered by the page under this form.
 */
export function SettingsPanel({
  prefs,
  timezone,
  exampleName = "Summer",
  focus = "all",
}: {
  prefs: NotificationPrefs;
  timezone: string;
  exampleName?: string;
  focus?: "all" | "quiet";
}) {
  const [state, action, pending] = useActionState(saveSettings, initial);
  const zonesReady = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const zoneList = zonesReady ? supportedTimeZones() : [timezone];
  const options = zoneList.includes(timezone)
    ? zoneList
    : [timezone, ...zoneList];

  useEffect(() => {
    rememberSounds(prefs.sounds);
  }, [prefs.sounds]);

  useEffect(() => {
    if (!state.saved) return;
    const form = document.getElementById("settings-form");
    const data = new FormData(
      form instanceof HTMLFormElement ? form : undefined,
    );
    rememberSounds(data.get("sounds") === "on");
    const theme = data.get("theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [state.saved]);

  return (
    <form id="settings-form" action={action} className="flex flex-col gap-5">
      {focus === "quiet" ? null : (
        <section
          className="card flex flex-col gap-3"
          aria-labelledby="notify-heading"
        >
          <h2 id="notify-heading" className="text-lg font-bold">
            Alerts
          </h2>
          <ul className="flex flex-col">
            {TOGGLES.map((toggle) => (
              <li key={toggle.name}>
                <Toggle
                  name={toggle.name}
                  label={toggle.label}
                  detail={toggle.detail}
                  defaultOn={Boolean(prefs[toggle.name])}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="card flex flex-col gap-3"
        aria-labelledby="quiet-heading"
      >
        <h2 id="quiet-heading" className="text-lg font-bold">
          Quiet hours
        </h2>
        <p className="text-sm leading-6 text-muted">
          Pings during these hours are held, in your own time zone. The sender
          sees “{exampleName}&apos;s in quiet hours, we&apos;ll deliver it at{" "}
          {formatResumeLabel(prefs.quiet.end)}”.
        </p>
        <Toggle
          name="quietEnabled"
          label="Do not disturb"
          detail="Hold pings until quiet hours end"
          defaultOn={prefs.quiet.enabled}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-bold">
            From
            <input
              type="time"
              name="quietStart"
              defaultValue={prefs.quiet.start}
              required
              className="h-12 rounded-2xl border border-line bg-background px-3 text-base font-medium"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Until
            <input
              type="time"
              name="quietEnd"
              defaultValue={prefs.quiet.end}
              required
              className="h-12 rounded-2xl border border-line bg-background px-3 text-base font-medium"
            />
          </label>
        </div>
      </section>

      {focus === "quiet" ? null : (
        <>
          <section
            className="card flex flex-col gap-3"
            aria-labelledby="zone-heading"
          >
            <h2 id="zone-heading" className="text-lg font-bold">
              Time zone
            </h2>
            <label className="sr-only" htmlFor="settings-zone">
              Time zone
            </label>
            <select
              id="settings-zone"
              name="timezone"
              defaultValue={timezone}
              className="h-12 rounded-2xl border border-line bg-background px-3 text-base"
            >
              {options.map((zone) => (
                <option key={zone} value={zone}>
                  {friendlyZoneLabel(zone)}
                </option>
              ))}
            </select>
          </section>

          <section
            className="card flex flex-col gap-3"
            aria-labelledby="theme-heading"
          >
            <h2 id="theme-heading" className="text-lg font-bold">
              Theme
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="tile justify-center text-sm">
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    defaultChecked={prefs.theme === value}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section
            className="card flex flex-col gap-3"
            aria-labelledby="sound-heading"
          >
            <h2 id="sound-heading" className="text-lg font-bold">
              Sound
            </h2>
            <Toggle
              name="sounds"
              label="Soft sounds"
              detail="Off unless you turn them on. A phone without vibration stays quiet."
              defaultOn={prefs.sounds}
            />
          </section>

          {state.error ? (
            <p className="text-sm text-accent" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.saved ? (
            <p className="text-sm font-bold text-pine" role="status">
              Saved.
            </p>
          ) : null}
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </button>
        </>
      )}
    </form>
  );
}

function Toggle({
  name,
  label,
  detail,
  defaultOn,
}: {
  name: string;
  label: string;
  detail: string;
  defaultOn: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-base font-bold">{label}</span>
        <span className="block text-sm text-muted">{detail}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        value="on"
        defaultChecked={defaultOn}
        className="switch"
        role="switch"
      />
    </label>
  );
}
