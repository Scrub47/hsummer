import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const requestUrl = z.string().url();

/** POST so a random image request cannot sign someone out. */
export async function POST(request: Request) {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const parsed = requestUrl.safeParse(request.url);
  const target = parsed.success
    ? new URL("/", parsed.data)
    : new URL("/", "http://localhost:3000");
  return NextResponse.redirect(target, { status: 303 });
}
