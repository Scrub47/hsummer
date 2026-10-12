import { NextResponse } from "next/server";

import { parsePushSubscription } from "@/lib/push/subscription";
import { getSession } from "@/lib/supabase/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { supabase, userId } = session;

  const body: unknown = await request.json().catch(() => null);
  const subscription = parsePushSubscription(body);
  if (!subscription) {
    return NextResponse.json(
      { error: "That subscription is not valid." },
      { status: 400 },
    );
  }

  // user_id comes from the verified session, never from the body.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
    { onConflict: "user_id,endpoint" },
  );

  if (error) {
    console.error("Could not save push subscription.");
    return NextResponse.json(
      { error: "Could not save this device." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { supabase, userId } = session;

  const body: unknown = await request.json().catch(() => null);
  const subscription = parsePushSubscription(body);
  if (!subscription) {
    return NextResponse.json(
      { error: "That subscription is not valid." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", subscription.endpoint);

  if (error) {
    console.error("Could not delete push subscription.");
    return NextResponse.json(
      { error: "Could not remove this device." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
