import "server-only";

import type { Session } from "@/lib/supabase/session";

/** Letter ids this person has pinned. A missing table is an empty shelf. */
export async function loadPinnedLetterIds(
  session: Session,
  circleId: string,
): Promise<string[]> {
  const { data, error } = await session.supabase
    .from("letter_pins")
    .select("letter_id")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => row.letter_id);
}
