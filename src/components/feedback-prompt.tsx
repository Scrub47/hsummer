"use client";

import { useState } from "react";

import { FeedbackSheet } from "@/components/feedback-sheet";
import { dismissFeedbackPrompt } from "@/app/profile/settings/actions";

/**
 * Shown once, from the root layout, after a week on the account or ten
 * letters. Closing it, or sending the note, writes the dismissal and this
 * component unmounts for good.
 */
export function FeedbackPrompt() {
  const [open, setOpen] = useState(true);

  function dismiss() {
    setOpen(false);
    void dismissFeedbackPrompt();
  }

  return (
    <FeedbackSheet
      open={open}
      onClose={dismiss}
      title="How's Hsummer so far?"
      intro="A quiet check-in. The rating stays with Isaac. It is not shown in your circle, and this question does not come back."
    />
  );
}
