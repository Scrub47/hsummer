/**
 * Part 2 routes and storage keys. The screens live under these names.
 *
 * - Settings: `/profile/settings`. Toggles, quiet hours, time zone, theme,
 *   and sounds are `account_private.notification_prefs`. Theme sets
 *   `data-theme` on `<html>` (light / dark). System omits the attribute.
 * - Pinned letters: `letter_pins`, shown as the Keepsakes shelf.
 * - Reactions and replies: `reactions` and `replies` on letters and memories.
 *   trackProductEvent("reaction_added") and trackProductEvent("reply_sent")
 *   take no message text.
 * - Memory book: `/circles/[id]/book` and `POST /api/keepsake`.
 *   trackProductEvent("keepsake_exported") when the PDF or a strip file is saved.
 * - Haptics and sound: `src/lib/feel/feedback.ts`. Sounds stay off until
 *   the Settings toggle writes `localStorage` key `hsummer-sounds`.
 * - Letter envelope: fold, seal, fly / arrive, unseal, slide.
 */
export const partTwo = {
  settingsRoute: "/profile/settings",
  themeAttribute: "data-theme",
  pinnedLetters: "letters.pinned",
  reactions: "reactions",
  memoryBook: "export.memory-book",
  haptics: "haptics",
  envelopeAnimation: "letters.envelope",
} as const;
