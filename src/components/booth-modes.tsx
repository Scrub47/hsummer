"use client";

import { useState } from "react";

import { PassBooth } from "@/components/pass-booth";
import { PhotoBooth } from "@/components/photo-booth";
import type { PassBlocked, PassTurn } from "@/lib/booth/fields";

/**
 * Solo stays the default so a strip can still be shot on one phone.
 * Pass it on is the async booth: one person, then the other.
 */
export function BoothModes({
  circleId,
  circleTitle,
  canStart,
  blocked,
  partnerName,
  turns,
  unavailable,
}: {
  circleId: string;
  circleTitle: string;
  canStart: boolean;
  blocked: PassBlocked | null;
  partnerName: string | null;
  turns: PassTurn[];
  unavailable: boolean;
}) {
  const yourTurn = turns.some(
    (turn) => turn.waitingOnYou && turn.status === "open",
  );
  const [mode, setMode] = useState<"solo" | "pass">(yourTurn ? "pass" : "solo");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Booth">
        <ModeButton
          pressed={mode === "solo"}
          label="On this phone"
          onChoose={() => setMode("solo")}
        />
        <ModeButton
          pressed={mode === "pass"}
          label="Pass it on"
          onChoose={() => setMode("pass")}
        />
      </div>
      {mode === "solo" ? (
        <PhotoBooth circleId={circleId} circleTitle={circleTitle} />
      ) : (
        <PassBooth
          circleId={circleId}
          canStart={canStart}
          blocked={blocked}
          partnerName={partnerName}
          turns={turns}
          unavailable={unavailable}
        />
      )}
    </div>
  );
}

function ModeButton({
  pressed,
  label,
  onChoose,
}: {
  pressed: boolean;
  label: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onChoose}
      className={`h-10 rounded-full border px-4 text-sm font-medium ${
        pressed
          ? "border-pine bg-pine text-white"
          : "border-line bg-card text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
