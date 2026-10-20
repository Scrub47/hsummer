/**
 * The seeded couple. These ids are also written in
 * supabase/migrations/20270125120000_launch_readiness.sql.
 * Alex is the account a reviewer signs into. Jordan is the other person.
 * Neither address can receive mail.
 */

export const DEMO_ALEX_ID = "a11ce000-0000-4000-8000-0000000000a1";
export const DEMO_JORDAN_ID = "a11ce000-0000-4000-8000-0000000000b2";
export const DEMO_CIRCLE_ID = "a11ce000-0000-4000-8000-0000000000c3";

export const DEMO_ALEX_EMAIL = "alex.demo@hsummer.invalid";
export const DEMO_JORDAN_EMAIL = "jordan.demo@hsummer.invalid";

/** Stable rows so a reset can recognize a circle that is already seeded. */
export const DEMO_PHOTO_KITCHEN_ID = "a11ce000-0000-4000-8000-0000000000d4";
export const DEMO_PHOTO_RAMEN_ID = "a11ce000-0000-4000-8000-0000000000d5";
export const DEMO_PHOTO_TRAIN_ID = "a11ce000-0000-4000-8000-0000000000d6";
export const DEMO_LETTER_ID = "a11ce000-0000-4000-8000-0000000000e5";
export const DEMO_SCHEDULED_LETTER_ID = "a11ce000-0000-4000-8000-0000000000e6";
export const DEMO_SEALED_LETTER_ID = "a11ce000-0000-4000-8000-0000000000e7";
export const DEMO_REPLY_LETTER_ID = "a11ce000-0000-4000-8000-0000000000e8";
export const DEMO_CHECKPOINT_HIT_ID = "a11ce000-0000-4000-8000-0000000000c7";
export const DEMO_CHECKPOINT_NEXT_ID = "a11ce000-0000-4000-8000-0000000000c8";
export const DEMO_COUNTDOWN_ID = "a11ce000-0000-4000-8000-0000000000c9";
export const DEMO_BOOTH_SESSION_ID = "a11ce000-0000-4000-8000-0000000000f1";
export const DEMO_ALEX_AVATAR =
  "a11ce000-0000-4000-8000-0000000000a1/a11ce000-0000-4000-8000-0000000000aa.png";
export const DEMO_JORDAN_AVATAR =
  "a11ce000-0000-4000-8000-0000000000b2/a11ce000-0000-4000-8000-0000000000bb.png";

/** Set on a local machine with no Supabase. Ignored on Vercel. */
export const DEMO_PREVIEW_COOKIE = "hsummer-demo-preview";

/**
 * Marks a demo session that was opened inside a cross-site iframe, so later
 * refreshes keep Partitioned cookies instead of replacing them with Lax.
 */
export const DEMO_EMBED_COOKIE = "hsummer-demo-embed";

/** A generated 1×1 JPEG. It is not a photograph of anyone. */
export const DEMO_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05,
  0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b,
  0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a,
  0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28,
  0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38,
  0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0x40, 0xff, 0xd9,
]);
