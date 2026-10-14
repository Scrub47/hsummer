/**
 * The wall is grouped by the calendar month of occurred_on, newest month
 * first, and can be narrowed to one tag. Dates are YYYY-MM-DD with no zone,
 * so the month does not depend on where the viewer is.
 */

import { formatMonth } from "@/lib/memories/fields";

export type MemoryCard = {
  id: string;
  kind: "photo" | "note";
  body: string | null;
  photoUrl: string | null;
  photoPath: string | null;
  tags: string[];
  visibility: "circle" | "selected";
  viewerNames: string[];
  occurredOn: string;
  createdAt: string;
  author: string;
  mine: boolean;
};

export type MemoryMonth = {
  key: string;
  label: string;
  memories: MemoryCard[];
};

export function groupMemories(
  memories: readonly MemoryCard[],
  tag: string | null,
): MemoryMonth[] {
  const wanted = tag?.trim().toLowerCase() || null;
  const filtered = wanted
    ? memories.filter((memory) => memory.tags.includes(wanted))
    : memories;

  const groups = new Map<string, MemoryCard[]>();
  for (const memory of filtered) {
    const key = memory.occurredOn.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const list = groups.get(key);
    if (list) list.push(memory);
    else groups.set(key, [memory]);
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: formatMonth(key),
      memories: [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function memoryTagList(memories: readonly MemoryCard[]): string[] {
  const tags = new Set<string>();
  for (const memory of memories) {
    for (const tag of memory.tags) tags.add(tag);
  }
  return [...tags].sort();
}

export function audienceLabel(memory: MemoryCard): string {
  if (memory.visibility === "circle") return "Everyone in the circle";
  if (!memory.mine) return "Shared with you";
  if (memory.viewerNames.length === 0) return "Only you";
  return `Shared with ${memory.viewerNames.join(", ")}`;
}
