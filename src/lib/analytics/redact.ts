/**
 * Last check before an event leaves the browser. Autocapture is already
 * off. This drops it anyway, and removes name and email fields if a future
 * call puts them on $set.
 */

const BANNED = new Set([
  "email",
  "$email",
  "name",
  "$name",
  "display_name",
  "full_name",
]);

const DROPPED_EVENTS = new Set([
  "$autocapture",
  "$copy_autocapture",
  "$rageclick",
  "$dead_click",
  "$snapshot",
]);

export type RedactableCapture = {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

export function redactCapture<T extends RedactableCapture>(event: T): T | null {
  if (DROPPED_EVENTS.has(event.event)) return null;
  strip(event.properties);
  if (event.$set) strip(event.$set);
  if (event.$set_once) strip(event.$set_once);
  return event;
}

function strip(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (BANNED.has(key)) delete record[key];
  }
}
