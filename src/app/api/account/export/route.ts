import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeAuthBucket } from "@/lib/auth/attempt";
import { decideAuthLimit } from "@/lib/auth/limit";
import { buildExportZip } from "@/lib/export/build";
import { enforceSharedLimit } from "@/lib/rate-limit/enforce";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/supabase/session";

const EXPORT_LIMIT = 3;
const EXPORT_WINDOW_MINUTES = 60;
const DIRECT_MAX = 3_500_000;
const SIGNED_SECONDS = 10 * 60;

const bodySchema = z.object({}).strict();

/**
 * Streams a ZIP when it is small enough for one response. A larger archive
 * is written to the private exports bucket and this returns a short-lived
 * link to that one file. The ZIP contains the image bytes, not signed URLs.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const raw = await request.text();
  const parsed = bodySchema.safeParse(raw.length === 0 ? {} : safeJson(raw));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const limited = await limitExport(session.userId);
  if (!limited) {
    return NextResponse.json(
      { error: "You can download your data three times an hour." },
      { status: 429 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await buildExportZip(session);
  } catch (error) {
    console.error(
      "Export failed.",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "The download couldn't be built." },
      { status: 500 },
    );
  }

  if (bytes.byteLength <= DIRECT_MAX) {
    return new NextResponse(new Blob([Buffer.from(bytes)]), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="hsummer-export.zip"',
        "Cache-Control": "no-store",
      },
    });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "The download couldn't be built." },
      { status: 500 },
    );
  }

  const objectPath = `pending/${Date.now()}_${session.userId}_${crypto.randomUUID()}.zip`;
  const uploaded = await admin.storage
    .from("exports")
    .upload(objectPath, Buffer.from(bytes), {
      contentType: "application/zip",
      upsert: false,
    });
  if (uploaded.error) {
    console.error("Export archive was not stored.");
    return NextResponse.json(
      { error: "The download couldn't be built." },
      { status: 500 },
    );
  }

  const signed = await admin.storage
    .from("exports")
    .createSignedUrl(objectPath, SIGNED_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { error: "The download couldn't be built." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.data.signedUrl });
}

async function limitExport(userId: string): Promise<boolean> {
  const key = `export:${userId}`;
  const shared = await enforceSharedLimit({
    key,
    limit: EXPORT_LIMIT,
    window: `${EXPORT_WINDOW_MINUTES} m`,
    error: "limited",
  });
  if (!shared.ok) return false;
  if (shared.source === "upstash") return true;

  const allowed = await consumeAuthBucket({
    bucket: key,
    limit: EXPORT_LIMIT,
    windowSeconds: EXPORT_WINDOW_MINUTES * 60,
  });
  const decision = decideAuthLimit({
    upstashEnforced: false,
    databaseAllowed: allowed,
    production: process.env.NODE_ENV === "production",
  });
  return decision.ok;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
