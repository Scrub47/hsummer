import "server-only";

import { randomBytes } from "node:crypto";

import {
  DEMO_ALEX_EMAIL,
  DEMO_ALEX_ID,
  DEMO_CIRCLE_ID,
  DEMO_JORDAN_EMAIL,
  DEMO_JORDAN_ID,
  DEMO_JPEG,
} from "@/lib/demo/ids";
import { MEMORIES_BUCKET } from "@/lib/memories/fields";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rebuilds the fictional Alex & Jordan circle and puts the generated JPEG
 * where the new rows point. It only touches those two fixed accounts and
 * that one circle id. A missing profile is created here. An existing account
 * with a different id at the same email is left alone.
 */

export async function resetDemoCircle(): Promise<
  { ok: true; circleId: string } | { ok: false }
> {
  const admin = createAdminClient();
  if (!admin) return { ok: false };

  const ready = await Promise.all([
    ensureDemoUser(admin, {
      id: DEMO_ALEX_ID,
      email: DEMO_ALEX_EMAIL,
      displayName: "Alex",
      timezone: "America/Los_Angeles",
    }),
    ensureDemoUser(admin, {
      id: DEMO_JORDAN_ID,
      email: DEMO_JORDAN_EMAIL,
      displayName: "Jordan",
      timezone: "America/New_York",
    }),
  ]);
  if (ready.some((result) => !result)) return { ok: false };

  const seeded = await admin.rpc("seed_demo_circle", {
    photo_bytes: DEMO_JPEG.byteLength,
  });
  if (seeded.error || !seeded.data) {
    console.error("Demo circle was not seeded.", seeded.error?.code);
    return { ok: false };
  }

  const photoPath = seeded.data.photoPath;
  const boothPaths = Array.isArray(seeded.data.boothPaths)
    ? seeded.data.boothPaths.filter(
        (path): path is string => typeof path === "string",
      )
    : [];
  const paths = [photoPath, ...boothPaths];

  for (const path of paths) {
    const uploaded = await admin.storage
      .from(MEMORIES_BUCKET)
      .upload(path, DEMO_JPEG, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploaded.error) {
      console.error("Demo photo was not stored.", uploaded.error.message);
      return { ok: false };
    }
  }

  return { ok: true, circleId: seeded.data.circleId || DEMO_CIRCLE_ID };
}

async function ensureDemoUser(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  input: { id: string; email: string; displayName: string; timezone: string },
): Promise<boolean> {
  const existing = await admin.auth.admin.getUserById(input.id);
  if (existing.data.user) {
    if (existing.data.user.email !== input.email) return false;
    return true;
  }

  const created = await admin.auth.admin.createUser({
    id: input.id,
    email: input.email,
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName,
      timezone: input.timezone,
    },
  });
  if (created.error || !created.data.user) {
    console.error("Demo account was not created.", created.error?.message);
    return false;
  }
  if (created.data.user.id !== input.id) return false;
  return true;
}
