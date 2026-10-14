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

/**
 * Thinking of You, still without a name. "Missing you" is the secret variant.
 * The recipient's display name stays in the app, behind sign-in.
 */
export const PING_NOTIFICATION_BODY = "Thinking of you.";
export const PING_SECRET_NOTIFICATION_BODY = "Missing you.";

/** A letter arrived. The lock screen does not say who, or what it says. */
export const LETTER_NOTIFICATION_BODY = "You have a new letter.";

const CIRCLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildTestNotification(origin: string): TestNotification {
  const base = new URL(origin);
  return {
    title: "Hsummer",
    body: TEST_NOTIFICATION_BODY,
    url: new URL("/home", base.origin).toString(),
  };
}

export function buildPingNotification(
  origin: string,
  input: { secretVariant: boolean; circleId: string },
): TestNotification {
  const base = new URL(origin);
  const path = CIRCLE_ID_PATTERN.test(input.circleId)
    ? `/circles/${input.circleId}`
    : "/home";
  return {
    title: "Hsummer",
    body: input.secretVariant
      ? PING_SECRET_NOTIFICATION_BODY
      : PING_NOTIFICATION_BODY,
    url: new URL(path, base.origin).toString(),
  };
}

export function buildLetterNotification(
  origin: string,
  circleId: string,
): TestNotification {
  const base = new URL(origin);
  const path = CIRCLE_ID_PATTERN.test(circleId)
    ? `/circles/${circleId}`
    : "/home";
  return {
    title: "Hsummer",
    body: LETTER_NOTIFICATION_BODY,
    url: new URL(path, base.origin).toString(),
  };
}
