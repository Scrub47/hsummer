/** "Isaac Hsu" greets as Isaac. A single-word name stays whole. */
export function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
