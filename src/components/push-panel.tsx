"use client";

import { useState } from "react";

import {
  InstallHint,
  iosInstallRequired,
  useNeedsIosInstall,
} from "@/components/install-hint";
import { getVapidPublicKey } from "@/lib/env";
import { urlBase64ToUint8Array } from "@/lib/push/subscription";

type Status = { tone: "error" | "ok"; text: string } | null;

export function PushPanel() {
  const [pending, setPending] = useState<"enable" | "test" | "disable" | null>(
    null,
  );
  const [readyToAsk, setReadyToAsk] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const needsInstall = useNeedsIosInstall();

  function beginEnable() {
    setStatus(null);
    if (iosInstallRequired()) {
      setStatus({
        tone: "error",
        text: "Add Hsummer to your Home Screen, open it from the icon, then enable notifications.",
      });
      return;
    }
    if (!getVapidPublicKey()) {
      setStatus({
        tone: "error",
        text: "VAPID keys aren't configured yet. Generate a pair and add it to .env.local.",
      });
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus({
        tone: "error",
        text: "This browser doesn't support web push.",
      });
      return;
    }
    setReadyToAsk(true);
  }

  async function enable() {
    setReadyToAsk(false);
    const publicKey = getVapidPublicKey();
    if (!publicKey) return;

    setPending("enable");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus({
          tone: "error",
          text: "Notification permission was not granted. On iPhone, open Hsummer from the Home Screen icon first.",
        });
        return;
      }

      const registration = await readyWithin(navigator.serviceWorker.ready);
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toBufferSource(
            urlBase64ToUint8Array(publicKey),
          ),
        }));

      const json = subscription.toJSON();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!response.ok) {
        setStatus({ tone: "error", text: "This device couldn't be saved." });
        return;
      }
      setStatus({
        tone: "ok",
        text: "This device is subscribed. Send a test notification.",
      });
    } catch {
      setStatus({
        tone: "error",
        text: "Couldn't subscribe this device. On iPhone, open Hsummer from the Home Screen icon, then try again.",
      });
    } finally {
      setPending(null);
    }
  }

  async function sendTest() {
    setStatus(null);
    setPending("test");
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        sent?: number;
        devices?: number;
        removed?: number;
      } | null;
      if (!response.ok) {
        setStatus({
          tone: "error",
          text: body?.error ?? "The test push failed.",
        });
        return;
      }
      const sent = body?.sent ?? 0;
      const devices = body?.devices ?? 0;
      const removed = body?.removed ?? 0;
      if (devices === 0) {
        setStatus({
          tone: "error",
          text: "No devices are saved yet. Enable notifications first.",
        });
        return;
      }
      setStatus({
        tone: sent > 0 ? "ok" : "error",
        text: `Sent to ${sent} of ${devices} device${devices === 1 ? "" : "s"}.${
          removed > 0
            ? ` Removed ${removed} expired subscription${removed === 1 ? "" : "s"}.`
            : ""
        }`,
      });
    } catch {
      setStatus({ tone: "error", text: "The test push failed." });
    } finally {
      setPending(null);
    }
  }

  async function disable() {
    setStatus(null);
    if (!("serviceWorker" in navigator)) return;
    setPending("disable");
    try {
      const registration = await readyWithin(navigator.serviceWorker.ready);
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setStatus({ tone: "ok", text: "This device was not subscribed." });
        return;
      }
      const json = subscription.toJSON();
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      await subscription.unsubscribe();
      setStatus({ tone: "ok", text: "Notifications are off on this device." });
    } catch {
      setStatus({ tone: "error", text: "Couldn't turn notifications off." });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold">Notifications</h2>
        {needsInstall ? null : (
          <p className="mt-1 text-sm text-muted">
            A test says only that notifications work. Lock screens are public.
          </p>
        )}
      </div>
      {needsInstall ? <InstallHint /> : null}
      {needsInstall ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {readyToAsk ? (
            <div className="card flex flex-col gap-3 p-4">
              <p className="text-sm leading-6">
                Thinking of You can show up on a lock screen. The browser will
                ask next. Hsummer does not put names or letters in that ping.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void enable()}
                  disabled={pending !== null}
                  className="btn"
                >
                  {pending === "enable" ? "Enabling…" : "Allow notifications"}
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setReadyToAsk(false)}
                >
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={beginEnable}
              disabled={pending !== null}
              className="btn"
            >
              Enable notifications
            </button>
          )}
          <button
            type="button"
            onClick={sendTest}
            disabled={pending !== null}
            className="inline-flex h-11 items-center justify-center rounded-full bg-pine px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending === "test" ? "Sending…" : "Send test notification"}
          </button>
          <button
            type="button"
            onClick={disable}
            disabled={pending !== null}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-medium disabled:opacity-60"
          >
            {pending === "disable" ? "Turning off…" : "Turn off on this device"}
          </button>
        </div>
      )}
      {status ? (
        <p
          className="text-sm leading-6"
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </p>
      ) : null}
    </section>
  );
}

/** `serviceWorker.ready` never settles when registration failed. */
function readyWithin(pending: Promise<ServiceWorkerRegistration>) {
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("service_worker_timeout")),
      10_000,
    );
    pending.then(
      (registration) => {
        clearTimeout(timer);
        resolve(registration);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * DOM lib types `applicationServerKey` as BufferSource. A fresh Uint8Array
 * is a BufferSource at runtime; the generic TS target sometimes disagrees.
 */
function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
