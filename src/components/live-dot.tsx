/**
 * A quiet chip for a circle feature whose live channel is down.
 * Connected and still-connecting states stay silent.
 */
export function LiveDot({ live }: { live: "connecting" | "live" | "off" }) {
  if (live !== "off") return null;
  return (
    <p className="live-chip">
      <span className="live-dot" aria-hidden="true" />
      Not live
    </p>
  );
}
