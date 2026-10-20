import "server-only";

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEMO_ALEX_EMAIL,
  DEMO_ALEX_ID,
  DEMO_CIRCLE_ID,
  DEMO_JORDAN_EMAIL,
  DEMO_JORDAN_ID,
  DEMO_JPEG,
  DEMO_SCHEDULED_LETTER_ID,
} from "@/lib/demo/ids";
import { demoMediaFile } from "@/lib/demo/media";
import { AVATARS_BUCKET } from "@/lib/profile/fields";
import { MEMORIES_BUCKET } from "@/lib/memories/fields";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

type DemoFile = {
  bucket: string;
  path: string;
  name: string;
};

/**
 * Rebuilds the fictional Alex & Jordan circle and uploads the drawings in
 * public/demo-media. It only touches those two fixed accounts and that one
 * circle id. A missing profile is created here. An existing account with a
 * different id at the same email is left alone.
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

  const uploaded = await uploadDemoFiles(admin, filesFromSeed(seeded.data));
  if (!uploaded) return { ok: false };

  return { ok: true, circleId: seeded.data.circleId || DEMO_CIRCLE_ID };
}

/**
 * Seeds only when the scheduled sample letter is missing. Entering the demo
 * does not wipe the circle out from under someone who is already looking.
 * The nightly cron still calls resetDemoCircle.
 */
export async function ensureDemoCircle(): Promise<
  { ok: true; circleId: string } | { ok: false }
> {
  const admin = createAdminClient();
  if (!admin) return { ok: false };

  const existing = await admin
    .from("letters")
    .select("id")
    .eq("id", DEMO_SCHEDULED_LETTER_ID)
    .maybeSingle();
  if (!existing.error && existing.data?.id === DEMO_SCHEDULED_LETTER_ID) {
    return { ok: true, circleId: DEMO_CIRCLE_ID };
  }
  return resetDemoCircle();
}

function filesFromSeed(data: {
  photoPath: string;
  boothPaths: string[];
  files?: DemoFile[] | null;
}): DemoFile[] {
  if (Array.isArray(data.files) && data.files.length > 0) {
    return data.files.filter(
      (file): file is DemoFile =>
        typeof file?.bucket === "string" &&
        typeof file?.path === "string" &&
        typeof file?.name === "string",
    );
  }
  const boothPaths = Array.isArray(data.boothPaths) ? data.boothPaths : [];
  return [
    { bucket: MEMORIES_BUCKET, path: data.photoPath, name: "kitchen" },
    ...boothPaths.map((path, index) => ({
      bucket: MEMORIES_BUCKET,
      path,
      name: `booth-${index}`,
    })),
  ];
}

async function uploadDemoFiles(
  admin: Admin,
  files: DemoFile[],
): Promise<boolean> {
  for (const file of files) {
    const filename = demoMediaFile(file.name);
    const bucket =
      file.bucket === AVATARS_BUCKET ? AVATARS_BUCKET : MEMORIES_BUCKET;
    if (!filename) {
      const uploaded = await admin.storage
        .from(bucket)
        .upload(file.path, DEMO_JPEG, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (uploaded.error) {
        console.error("Demo photo was not stored.", uploaded.error.message);
        return false;
      }
      continue;
    }
    const bytes = await readFile(
      path.join(process.cwd(), "public", "demo-media", filename),
    );
    const uploaded = await admin.storage.from(bucket).upload(file.path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (uploaded.error) {
      console.error("Demo drawing was not stored.", uploaded.error.message);
      return false;
    }
  }
  return true;
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
