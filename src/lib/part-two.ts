/**
 * Hooks for the next pass. Nothing here is a screen yet.
 *
 * - Settings: notification toggles, quiet hours, time zone, theme.
 *   `account_private.notification_prefs` is the column. Theme can set
 *   `data-theme` on `<html>` (light / dark) and the tokens already follow it.
 * - Pinned letters: a saved set, separate from the full letter list.
 * - Reactions and replies on letters, photos, and memories.
 * - Memory book: a keepsake export beside the existing ZIP.
 * - Haptics and sound on ping, seal, and mood.
 * - Letter-into-envelope: the seal animation in globals.css is the start.
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
