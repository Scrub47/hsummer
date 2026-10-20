"use client";

/** A short heart burst. Reduced motion leaves the hearts in place. */
export function HeartBurst({ label = "You hit it" }: { label?: string }) {
  return (
    <div className="heart-burst" role="status">
      <span aria-hidden>♥</span>
      <span aria-hidden>♥</span>
      <span aria-hidden>♥</span>
      <span aria-hidden>♥</span>
      <span aria-hidden>♥</span>
      <p className="text-sm font-bold text-pine">{label}</p>
    </div>
  );
}
