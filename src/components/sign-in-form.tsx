"use client";

import { useEffect, useRef, useState } from "react";

import { requestMagicLink, startGoogleSignIn } from "@/app/sign-in/actions";
import { AGE_REQUIRED_MESSAGE } from "@/lib/account/copy";
import { getSupabaseBrowserConfig, getTurnstileSiteKey } from "@/lib/env";

const ERROR_COPY: Record<string, string> = {
  "not-configured":
    "Supabase isn't configured yet. Add your project URL and publishable key to .env.local, then restart the dev server.",
  link: "That sign-in link didn't work. Request a new one and open it in this browser.",
};

export function SignInForm({
  errorCode,
  nextPath,
}: {
  errorCode?: string;
  nextPath?: string;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(
    errorCode ? (ERROR_COPY[errorCode] ?? ERROR_COPY.link) : null,
  );
  const [messageTone, setMessageTone] = useState<"error" | "ok">(
    errorCode ? "error" : "ok",
  );
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileSiteKey = getTurnstileSiteKey();

  const configured = getSupabaseBrowserConfig() !== null;

  useEffect(() => {
    const sitekey = turnstileSiteKey;
    if (!sitekey || !turnstileRef.current) return;
    const key = sitekey;
    const container = turnstileRef.current;
    let widgetId = "";
    let cancelled = false;

    function render() {
      if (cancelled || !container || !window.turnstile) return;
      widgetId = window.turnstile.render(container, {
        sitekey: key,
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [turnstileSiteKey]);

  async function signInWithGoogle() {
    setMessage(null);
    if (!configured) {
      setMessageTone("error");
      setMessage(ERROR_COPY["not-configured"]);
      return;
    }

    if (!ageConfirmed) {
      setMessageTone("error");
      setMessage(AGE_REQUIRED_MESSAGE);
      return;
    }

    if (turnstileSiteKey && !captchaToken) {
      setMessageTone("error");
      setMessage("Complete the check, then try again.");
      return;
    }

    setPending("google");
    const result = await startGoogleSignIn({
      nextPath,
      captchaToken: captchaToken ?? undefined,
      ageConfirmed: true,
    });
    if (!result.ok) {
      setPending(null);
      setMessageTone("error");
      setMessage(result.error);
      return;
    }
    if (result.kind !== "google") {
      setPending(null);
      return;
    }
    window.location.assign(result.url);
  }

  async function signInWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!configured) {
      setMessageTone("error");
      setMessage(ERROR_COPY["not-configured"]);
      return;
    }

    if (!ageConfirmed) {
      setMessageTone("error");
      setMessage(AGE_REQUIRED_MESSAGE);
      return;
    }

    if (turnstileSiteKey && !captchaToken) {
      setMessageTone("error");
      setMessage("Complete the check, then try again.");
      return;
    }

    setPending("email");
    const result = await requestMagicLink({
      email,
      nextPath,
      captchaToken: captchaToken ?? undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ageConfirmed: true,
    });
    setPending(null);

    if (!result.ok) {
      setMessageTone("error");
      setMessage(result.error);
      return;
    }

    setMessageTone("ok");
    setMessage("Check your email and open the link in this browser.");
  }

  return (
    <div className="flex flex-col gap-6">
      {!configured ? (
        <p
          className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
          role="status"
        >
          {ERROR_COPY["not-configured"]}
        </p>
      ) : null}

      {message ? (
        <p
          className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-6"
          role={messageTone === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={pending !== null}
        className="inline-flex h-12 items-center justify-center rounded-full bg-pine px-5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
      >
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      {turnstileSiteKey ? (
        <div ref={turnstileRef} className="min-h-16" />
      ) : null}

      <form onSubmit={signInWithEmail} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="h-12 rounded-2xl border border-line bg-card px-4 text-base outline-none ring-pine/40 focus:ring-2"
        />
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            name="age"
            checked={ageConfirmed}
            onChange={(event) => setAgeConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I am 13 or older</span>
        </label>
        <button
          type="submit"
          disabled={pending !== null}
          className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink transition-opacity disabled:opacity-60"
        >
          {pending === "email" ? "Sending…" : "Email me a link"}
        </button>
      </form>
    </div>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}
