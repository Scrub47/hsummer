import "server-only";

import { deleteLetterMessage } from "@/lib/schedule/qstash";

/** Cancels the QStash deliveries a leave or delete just marked cancelled. */
export async function cancelScheduledMessages(
  rows: { message_id: string | null }[] | null,
): Promise<void> {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    if (row.message_id) ids.add(row.message_id);
  }
  await Promise.all([...ids].map((id) => deleteLetterMessage(id)));
}
