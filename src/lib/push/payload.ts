/**
 * Notification copy that is safe to show on a lock screen.
 *
 * A lock screen is visible to anyone holding the phone. Push payloads must
 * not contain names, letter text, moods, or anything else that belongs to a
 * Circle. The test notification is generic on purpose, and later features
 * should follow the same shape: a title, a vague body, and a URL to open.
 */
export type TestNotification = {
  title: "Hsummer";
  body: string;
  url: string;
};

export const TEST_NOTIFICATION_BODY =
  "Test notification. Nothing private is in this message.";

export function buildTestNotification(origin: string): TestNotification {
  const base = new URL(origin);
  return {
    title: "Hsummer",
    body: TEST_NOTIFICATION_BODY,
    url: new URL("/home", base.origin).toString(),
  };
}
