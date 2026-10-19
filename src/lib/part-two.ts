/**
 * Part 2 routes and storage keys. The screens live under these names.
 *
 * - Settings: `/profile/settings`. Toggles, quiet hours, time zone, theme,
 *   and sounds are `account_private.notification_prefs`. Theme sets
 *   `data-theme` on `<html>` (light / dark). System omits the attribute.
 * - Pinned letters: `letter_pins`, shown as the Keepsakes shelf.
 * - Reactions and replies: `reactions` and `replies` on letters and memories.
 * - Memory book: `/circles/[id]/book` and `POST /api/keepsake`.
 * - Haptics and sound: `src/lib/feel/feedback.ts`. Sounds stay off until
 *   the Settings toggle writes `localStorage` key `hsummer-sounds`.
 * - Letter-into-envelope: `EnvelopeFlight` and the envelope frames in
 *   `globals.css`.
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
