/**
 * The only product events Hsummer sends to PostHog.
 *
 * Properties are a closed list of short labels. Letter text, names, emails,
 * captions, and emoji never qualify, so a caller cannot attach them by
 * accident. reaction_added, reply_sent, and keepsake_exported are part of
 * this list for the reactions, replies, and memory-book export named in
 * part-two.ts. Those screens are not built yet. Call trackProductEvent
 * with the name and no message text when they are.
 */

export const PRODUCT_EVENTS = [
  "signed_up",
  "circle_created",
  "partner_joined",
  "letter_sent",
  "letter_opened",
  "ping_sent",
  "mood_shared",
  "booth_photo_taken",
  "strip_completed",
  "memory_added",
  "reaction_added",
  "reply_sent",
  "keepsake_exported",
  "push_enabled",
] as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

const PROPERTY_VALUES = {
  circle_type: ["couple", "group", "family", "friends"],
  mode: ["solo", "pass", "together"],
} as const;

export type ProductProperties = {
  -readonly [
    Key in keyof typeof PROPERTY_VALUES
  ]?: (typeof PROPERTY_VALUES)[Key][number];
};

export function isProductEvent(value: string): value is ProductEvent {
  return (PRODUCT_EVENTS as readonly string[]).includes(value);
}

function allowedLabel<Key extends keyof typeof PROPERTY_VALUES>(
  key: Key,
  properties: Record<string, unknown>,
): ProductProperties[Key] | undefined {
  const value = properties[key];
  const allowed: readonly string[] = PROPERTY_VALUES[key];
  if (typeof value === "string" && allowed.includes(value)) {
    return value as ProductProperties[Key];
  }
  return undefined;
}

/** Drops anything that is not an allowed label. Unknown keys are ignored. */
export function sanitizeEventProperties(
  properties: Record<string, unknown> | undefined,
): ProductProperties {
  if (!properties) return {};
  const circleType = allowedLabel("circle_type", properties);
  const mode = allowedLabel("mode", properties);
  return {
    ...(circleType ? { circle_type: circleType } : {}),
    ...(mode ? { mode } : {}),
  };
}
