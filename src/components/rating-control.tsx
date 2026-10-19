"use client";

import { useId, useRef } from "react";

const values = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof values)[number];

/**
 * A 1 to 5 radio group. It is not a native range input, so the value is
 * the button itself and a screen reader hears "3 out of 5".
 */
export function RatingControl({
  value,
  onChange,
  labelledBy,
}: {
  value: Rating | null;
  onChange: (value: Rating) => void;
  labelledBy?: string;
}) {
  const groupId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const focus: Rating = value ?? 1;

  function move(next: Rating) {
    onChange(next);
    buttons.current[next - 1]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Rating from 1 to 5"}
      className="rating"
      id={groupId}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move((Math.min(5, focus + 1) || 1) as Rating);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move((Math.max(1, focus - 1) || 1) as Rating);
        }
      }}
    >
      {values.map((item) => {
        const selected = value === item;
        return (
          <button
            key={item}
            ref={(node) => {
              buttons.current[item - 1] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${item} out of 5`}
            tabIndex={focus === item ? 0 : -1}
            className="rating-choice"
            onClick={() => move(item)}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}
