import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip Next internals and static files. The service worker and icons must
     * stay cacheable and must not depend on an auth cookie. /ingest is the
     * PostHog rewrite and must not run the session refresh.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|ingest(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
