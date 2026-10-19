"use client";

import { useState } from "react";

import { LiveTogether } from "@/components/live-together";
import { PassBooth } from "@/components/pass-booth";
import { PhotoBooth } from "@/components/photo-booth";
import type { PassBlocked, PassTurn, TogetherLobby } from "@/lib/booth/fields";

/**
 * Solo stays the default so a strip can still be shot on one phone.
 * Pass it on is the async booth: one person, then the other.
 */
export function BoothModes({
  circleId,
  circleTitle,
  canStart,
  blocked,
  people,
  needsPicker,
  selfId,
  turns,
  lobby,
  unavailable,
}: {
  circleId: string;
  circleTitle: string;
  canStart: boolean;
  blocked: PassBlocked | null;
  people: { userId: string; displayName: string }[];
  needsPicker: boolean;
  selfId: string;
  turns: PassTurn[];
  lobby: TogetherLobby | null;
  unavailable: boolean;
}) {
  const yourTurn = turns.some(
    (turn) => turn.waitingOnYou && turn.status === "open",
  );
  const [mode, setMode] = useState<"solo" | "pass" | "together">(
    lobby ? "together" : yourTurn ? "pass" : "solo",
  );

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
        <ModeButton
          pressed={mode === "together"}
          label="Live together"
          onChoose={() => setMode("together")}
        />
      </div>
      {mode === "solo" ? (
        <PhotoBooth circleId={circleId} circleTitle={circleTitle} />
      ) : null}
      {mode === "pass" ? (
        <PassBooth
          circleId={circleId}
          canStart={canStart}
          blocked={blocked === "group" ? null : blocked}
          people={people}
          turns={turns}
          unavailable={unavailable}
        />
      ) : null}
      {mode === "together" ? (
        <LiveTogether
          circleId={circleId}
          canStart={canStart}
          blocked={
            blocked === "pending"
              ? "pending"
              : blocked === "alone"
                ? "alone"
                : null
          }
          people={people}
          needsPicker={needsPicker}
          selfId={selfId}
          lobby={lobby}
        />
      ) : null}
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
