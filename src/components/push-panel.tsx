"use client";

import { useState } from "react";

import { getVapidPublicKey } from "@/lib/env";
import { urlBase64ToUint8Array } from "@/lib/push/subscription";

type Status = { tone: "error" | "ok"; text: string } | null;

export function PushPanel() {
  const [pending, setPending] = useState<"enable" | "test" | "disable" | null>(
    null,
  );
  const [status, setStatus] = useState<Status>(null);

  async function enable() {
    setStatus(null);
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
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

      const registration = await navigator.serviceWorker.ready;
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
        text: "Couldn't subscribe this device. On iPhone, install Hsummer to the Home Screen first.",
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
      const registration = await navigator.serviceWorker.ready;
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
        <h2 className="font-serif text-2xl">Notifications</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/80">
          A test push says only that notifications work. It never includes a
          name, a letter, or anything else private — lock screens are public.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={enable}
          disabled={pending !== null}
          className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {pending === "enable" ? "Enabling…" : "Enable notifications"}
        </button>
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
