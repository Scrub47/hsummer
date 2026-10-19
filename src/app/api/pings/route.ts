import { NextResponse } from "next/server";

import { parsePingRequest } from "@/lib/pings/fields";
import { sendThinkingOfYou } from "@/lib/pings/send";
import { getSession } from "@/lib/supabase/session";

/**
 * Thinking of You. POST, not GET: a GET would run from a prefetch or an
 * embedded image and could buzz someone's phone.
 *
 * The body is `{ circleId, secretVariant? }`. A couple omits the recipient.
 * A larger circle may send `toUserId` as one member, or null for everyone.
 *
 * Node.js runtime (the default). `web-push` needs Node crypto.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = parsePingRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status },
    );
  }

  const origin = new URL(request.url).origin;
  const result = await sendThinkingOfYou(session, {
    circleId: parsed.circleId,
    secretVariant: parsed.secretVariant,
    origin,
    recipient: parsed.recipient,
  });

  return NextResponse.json(result.body, { status: result.status });
}
