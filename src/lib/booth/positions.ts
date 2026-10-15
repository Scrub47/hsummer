/**
 * Splits a strip's frames across the people in one booth.
 *
 * The person who starts is first, so an uneven split gives them the extra
 * frame (a 4-cut with three people is 2 + 1 + 1). The sets cover every
 * position once. The database repeats this split and rejects anything else.
 */

import type { BoothLayout } from "@/lib/booth/fields";
import { shotCount } from "@/lib/booth/fields";

export function assignPositions(
  layout: BoothLayout,
  people: number,
): number[][] | null {
  const slots = shotCount(layout);
  if (!Number.isInteger(people) || people < 2 || people > slots) return null;
  const base = Math.floor(slots / people);
  const extra = slots % people;
  const plan: number[][] = [];
  let cursor = 0;
  for (let person = 0; person < people; person += 1) {
    const take = base + (person < extra ? 1 : 0);
    const slice: number[] = [];
    for (let step = 0; step < take; step += 1) {
      slice.push(cursor);
      cursor += 1;
    }
    plan.push(slice);
  }
  return plan;
}
