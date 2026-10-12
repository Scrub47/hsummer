"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { getSupabaseBrowserConfig } from "@/lib/env";

const ERROR_COPY: Record<string, string> = {
  "not-configured":
    "Supabase isn't configured yet. Add your project URL and publishable key to .env.local, then restart the dev server.",
  link: "That sign-in link didn't work. Request a new one and open it in this browser.",
};

export function SignInForm({ errorCode }: { errorCode?: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(
    errorCode ? (ERROR_COPY[errorCode] ?? ERROR_COPY.link) : null,
  );
  const [messageTone, setMessageTone] = useState<"error" | "ok">(
    errorCode ? "error" : "ok",
  );
  const [pending, setPending] = useState<"google" | "email" | null>(null);

  const configured = getSupabaseBrowserConfig() !== null;

  async function signInWithGoogle() {
    setMessage(null);
    if (!configured) {
      setMessageTone("error");
      setMessage(ERROR_COPY["not-configured"]);
      return;
    }

    const supabase = createClient();
    if (!supabase) return;

    setPending("google");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setPending(null);
    if (error) {
      setMessageTone("error");
      setMessage(
        "Google sign-in didn't start. Check that the Google provider is enabled.",
      );
    }
  }

  async function signInWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!configured) {
      setMessageTone("error");
      setMessage(ERROR_COPY["not-configured"]);
      return;
    }

    const supabase = createClient();
    if (!supabase) return;

    setPending("email");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    });
    setPending(null);

    if (error) {
      setMessageTone("error");
      setMessage(
        "The magic link couldn't be sent. Check the email address and try again.",
      );
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
