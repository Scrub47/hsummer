/**
 * Rebuilds the fictional Alex & Jordan circle.
 *
 *   node --env-file=.env.local scripts/reset-demo.mjs
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY). Does not print those values.
 * The accounts are the same ids as src/lib/demo/ids.ts.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEMO_ALEX_ID = "a11ce000-0000-4000-8000-0000000000a1";
const DEMO_JORDAN_ID = "a11ce000-0000-4000-8000-0000000000b2";
const DEMO_CIRCLE_ID = "a11ce000-0000-4000-8000-0000000000c3";
const DEMO_ALEX_EMAIL = "alex.demo@hsummer.invalid";
const DEMO_JORDAN_EMAIL = "jordan.demo@hsummer.invalid";

const MEDIA = {
  kitchen: "kitchen.png",
  ramen: "ramen.png",
  train: "train.png",
  "booth-0": "booth-0.png",
  "booth-1": "booth-1.png",
  "booth-2": "booth-2.png",
  "booth-3": "booth-3.png",
  "avatar-alex": "avatar-alex.png",
  "avatar-jordan": "avatar-jordan.png",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY, then run this again.",
  );
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const users = [
  {
    id: DEMO_ALEX_ID,
    email: DEMO_ALEX_EMAIL,
    displayName: "Alex",
    timezone: "America/Los_Angeles",
  },
  {
    id: DEMO_JORDAN_ID,
    email: DEMO_JORDAN_EMAIL,
    displayName: "Jordan",
    timezone: "America/New_York",
  },
];

for (const user of users) {
  const existing = await admin.auth.admin.getUserById(user.id);
  if (existing.data.user) {
    if (existing.data.user.email !== user.email) {
      console.error("A different account already uses a demo id.");
      process.exit(1);
    }
    continue;
  }
  const created = await admin.auth.admin.createUser({
    id: user.id,
    email: user.email,
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
    user_metadata: {
      display_name: user.displayName,
      timezone: user.timezone,
    },
  });
  if (created.error) {
    console.error("Demo account was not created.");
    process.exit(1);
  }
}

const seeded = await admin.rpc("seed_demo_circle", { photo_bytes: 2048 });
if (seeded.error || !seeded.data) {
  console.error("Demo circle was not seeded.");
  process.exit(1);
}

const files = Array.isArray(seeded.data.files) ? seeded.data.files : [];
for (const file of files) {
  const filename = MEDIA[file.name];
  if (
    !filename ||
    typeof file.path !== "string" ||
    typeof file.bucket !== "string"
  ) {
    continue;
  }
  const bytes = await readFile(
    path.join(process.cwd(), "public", "demo-media", filename),
  );
  const uploaded = await admin.storage
    .from(file.bucket)
    .upload(file.path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploaded.error) {
    console.error("Demo drawing was not stored.");
    process.exit(1);
  }
}

console.log(`Demo circle ready: ${seeded.data.circleId || DEMO_CIRCLE_ID}`);
