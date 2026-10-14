"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const message = error.message.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!message) return;
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, path: window.location.pathname }),
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#f3ecdf",
          color: "#1c1915",
          fontFamily: "Georgia, serif",
        }}
      >
        <main
          style={{
            maxWidth: "32rem",
            margin: "0 auto",
            padding: "4rem 1.5rem",
          }}
        >
          <h1 style={{ fontSize: "2.4rem", fontWeight: 500 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: "1rem", lineHeight: 1.6 }}>
            Hsummer hit an error it could not show inside the page. Try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              border: 0,
              borderRadius: "999px",
              background: "#c4552a",
              color: "#fff8f3",
              padding: "0.75rem 1.25rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
