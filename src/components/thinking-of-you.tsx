"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Heart } from "lucide-react";

import { pushToast } from "@/components/toast-host";
import { tapFeedback } from "@/lib/feel/feedback";
import { missingName } from "@/lib/pings/fields";

const LONG_PRESS_MS = 700;

type Status = { tone: "error" | "ok"; text: string } | null;

/**
 * One tap sends Thinking of You to the partner. There is no recipient picker.
 *
 * Long-press, or the visually hidden button, sends the Missing<name>
 * variant. The name is not the visible label. The push says "Missing you"
 * and the list inside the app says "Missing Summer".
 */
export function ThinkingOfYou({
  circleId,
  partnerName,
  people = [],
  hero = false,
}: {
  circleId: string;
  partnerName: string;
  people?: { userId: string; displayName: string }[];
  hero?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [recipient, setRecipient] = useState(
    people.length > 1 ? (people[0]?.userId ?? "everyone") : "",
  );
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressSent = useRef(false);
  const hiddenLabel = missingName(partnerName);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  async function send(secretVariant: boolean) {
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    setPulse(true);
    setStatus(null);
    tapFeedback("ping");
    try {
      const chosen =
        people.length > 1
          ? recipient === "everyone"
            ? null
            : recipient
          : undefined;
      if (people.length > 1 && secretVariant && chosen === null) {
        setStatus({
          tone: "error",
          text: "The Missing note goes to one person.",
        });
        return;
      }
      const response = await fetch("/api/pings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          circleId,
          secretVariant,
          ...(chosen !== undefined ? { toUserId: chosen } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        ok?: boolean;
        sent?: number;
        devices?: number;
        push?: string;
        quietNotice?: string;
      } | null;
      if (!response.ok) {
        setStatus({
          tone: "error",
          text: body?.error ?? "That ping couldn't be sent.",
        });
        return;
      }
      const label =
        people.length > 1
          ? recipient === "everyone"
            ? "everyone"
            : (people.find((person) => person.userId === recipient)
                ?.displayName ?? partnerName)
          : partnerName;
      setStatus({ tone: "ok", text: successText(body, label) });
      pushToast(body?.quietNotice ?? "Ping sent");
      router.refresh();
    } catch {
      setStatus({ tone: "error", text: "That ping couldn't be sent." });
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }

  const many = people.length > 1;

  return (
    <section className="flex flex-col gap-4">
      {many ? (
        <label className="flex flex-col gap-2 text-sm font-medium">
          Who this is for
          <select
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            className="h-12 rounded-2xl border border-line bg-card px-4 text-base font-normal"
          >
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
            <option value="everyone">Everyone</option>
          </select>
        </label>
      ) : null}
      <button type="button" className="sr-only" onClick={() => void send(true)}>
        {hiddenLabel}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (longPressSent.current) {
            longPressSent.current = false;
            return;
          }
          void send(false);
        }}
        onPointerDown={(event) => {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // A mouse that has already left cannot be captured.
          }
          clearTimer();
          longPressSent.current = false;
          timer.current = setTimeout(() => {
            longPressSent.current = true;
            void send(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(event) => event.preventDefault()}
        className="btn no-callout h-14 w-full touch-manipulation text-lg select-none"
      >
        <span
          className={pulse ? "heart-pulse" : "inline-flex"}
          aria-hidden="true"
        >
          <Heart size={22} fill="currentColor" />
        </span>
        {pending ? "Sending…" : "Thinking of You"}
      </button>
      {hero || !many ? null : (
        <p className="text-sm leading-6 text-foreground/80">
          Choose one person, or everyone. A long press sends Missing you to one
          person, not to everyone.
        </p>
      )}
      {status ? (
        <p
          className="text-sm leading-6"
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </p>
      ) : null}
      {status?.tone === "error" ? (
        <button
          type="button"
          className="btn-quiet"
          onClick={() => void send(false)}
        >
          Try again
        </button>
      ) : null}
    </section>
  );
}

function successText(
  body: {
    sent?: number;
    devices?: number;
    push?: string;
    quietNotice?: string;
  } | null,
  partnerName: string,
): string {
  if (body?.quietNotice) return body.quietNotice;
  if (!body || body.push === "unconfigured") {
    return `Saved for ${partnerName}. Notifications aren't configured on the server yet.`;
  }
  if (body.push === "none" || (body.devices ?? 0) === 0) {
    return `Saved for ${partnerName}. They'll see it here. Their phone buzzes after they turn notifications on.`;
  }
  if ((body.sent ?? 0) > 0) {
    const devices = body.devices ?? 0;
    return devices > 1
      ? `Sent to ${partnerName}, on ${body.sent} of ${devices} devices.`
      : `Sent to ${partnerName}.`;
  }
  return `Saved for ${partnerName}. Their devices couldn't be reached just now.`;
}
