"use client";

import { useState } from "react";

import { FeedbackSheet } from "@/components/feedback-sheet";

export function SettingsFeedback() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading" className="text-xl font-bold">
        Feedback
      </h2>
      <p className="max-w-xl text-sm leading-6 text-foreground/80">
        A rating, and a note if you want one. Isaac can read it. People in your
        circles cannot.
      </p>
      <button type="button" className="btn w-fit" onClick={() => setOpen(true)}>
        Send feedback
      </button>
      {sent ? (
        <p className="text-sm text-pine" role="status">
          Sent. Thank you.
        </p>
      ) : null}
      <FeedbackSheet
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => setSent(true)}
        title="Send feedback"
        intro="One to five, and anything else you want to say. The note is optional."
      />
    </section>
  );
}
