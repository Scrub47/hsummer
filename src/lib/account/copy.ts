/**
 * Sentences shared by the leave screen, the delete screen, and the write
 * actions. A demo account and the demo circle use the same refusal.
 */

export const DEMO_READONLY_MESSAGE =
  "This demo circle is only for looking. It resets every night, and it doesn't take photos, letters, or notifications.";

export const COUPLE_CLOSED_MESSAGE =
  "This couple circle can't invite someone new. The history stays with whoever is left. Start a new circle for someone else.";

export const AGE_REQUIRED_MESSAGE =
  "Confirm you are 13 or older to use Hsummer.";

export function demoWriteMessage(message: string | undefined): string | null {
  if (!message) return null;
  if (
    message.includes("hsummer_demo_readonly") ||
    message.includes("hsummer_demo_closed")
  ) {
    return DEMO_READONLY_MESSAGE;
  }
  if (message.includes("hsummer_couple_closed")) return COUPLE_CLOSED_MESSAGE;
  return null;
}
