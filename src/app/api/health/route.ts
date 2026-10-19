import { NextResponse } from "next/server";
import { z } from "zod";

const body = z.object({
  ok: z.literal(true),
  service: z.literal("hsummer"),
});

/**
 * Liveness for an uptime check. It does not read the database and it does
 * not reveal configuration. A 200 means this process answered.
 */
export function GET() {
  const payload = body.parse({ ok: true, service: "hsummer" });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
