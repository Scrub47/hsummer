import { NextResponse } from "next/server";
import { z } from "zod";

const body = z.object({
  serverNow: z.number().int(),
});

/**
 * Server clock for Live Together. The browser samples this a few times,
 * keeps the smallest round trip, and fires when its estimated server time
 * reaches captureAt. Nothing here is private.
 */
export function GET() {
  const payload = body.parse({ serverNow: Date.now() });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
