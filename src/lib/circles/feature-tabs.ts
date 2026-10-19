/**
 * Hash names shared by the home shortcuts and the circle chips.
 * An empty hash is the circle home, not a feature.
 */
const HASH_TO_FEATURE: Record<string, string> = {
  "memory-heading": "memory",
  memory: "memory",
  "letters-heading": "letters",
  "mood-heading": "moods",
  "still-us-heading": "still",
  "bucket-heading": "bucket",
  booth: "booth",
  ping: "ping",
};

const FEATURE_HASH: Record<string, string> = {
  ping: "ping",
  moods: "mood-heading",
  letters: "letters-heading",
  bucket: "bucket-heading",
  still: "still-us-heading",
  booth: "booth",
  memory: "memory-heading",
};

export function featureFromHash(hash: string): string | null {
  const id = hash.replace(/^#/, "");
  if (!id) return null;
  return HASH_TO_FEATURE[id] ?? null;
}

export function featureHash(featureId: string): string | null {
  return FEATURE_HASH[featureId] ?? null;
}
