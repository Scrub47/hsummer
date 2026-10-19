"use client";

import { useEffect } from "react";

import { rememberSounds } from "@/lib/feel/feedback";

/** Keeps the sound toggle from Settings on this device. Default is off. */
export function SoundSync({ on }: { on: boolean }) {
  useEffect(() => {
    rememberSounds(on);
  }, [on]);
  return null;
}
