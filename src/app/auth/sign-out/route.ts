import { NextResponse } from "next/server";
import { z } from "zod";

import { redirectOrigin } from "@/lib/auth/request-origin";
import { DEMO_EMBED_COOKIE, DEMO_PREVIEW_COOKIE } from "@/lib/demo/ids";
import { createClient } from "@/lib/supabase/server";

const requestUrl = z.string().url();

/** POST so a random image request cannot sign someone out. */
export async function POST(request: Request) {
  const parsed = requestUrl.safeParse(request.url);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const target = new URL("/", redirectOrigin(request));
  const response = NextResponse.redirect(target, { status: 303 });
  const expired = { path: "/", maxAge: 0 };
  response.cookies.set(DEMO_PREVIEW_COOKIE, "", expired);
  response.cookies.set(DEMO_EMBED_COOKIE, "", expired);
  response.cookies.set(DEMO_EMBED_COOKIE, "", {
    ...expired,
    secure: true,
    sameSite: "none",
    partitioned: true,
  });
  return response;
}
