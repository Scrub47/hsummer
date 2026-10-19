"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";

export function InfoTip({
  label = "More info",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="info-tip">
      <button
        type="button"
        className="icon-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <Info aria-hidden="true" size={18} />
      </button>
      {open ? (
        <span id={id} role="note" className="info-pop">
          {children}
        </span>
      ) : null}
    </span>
  );
}
