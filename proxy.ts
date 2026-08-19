import { NextResponse, type NextRequest } from "next/server";

/**
 * Session gate. Renamed from middleware.ts — the middleware convention is
 * deprecated in Next 16.
 *
 * This is an optimistic check only. It keeps unauthenticated browsers out of
 * the office and field UI; it is NOT the authorization boundary, because server
 * actions are POSTs to the route that declares them and a matcher change can
 * silently drop coverage. Anything that reads or writes real data re-checks.
 *
 * The client portal (/p/:token) is deliberately public — the token in the URL
 * is the credential, verified in the route itself. The Telnyx webhook is public
 * for the same reason: its credential is the Ed25519 signature, which the route
 * checks before it reads a single field.
 */

const SESSION_COOKIE = "hd_session";

function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "hydrodam-ops-dev";
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && token === sessionSecret()) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // everything except the portal, auth routes, the signed Telnyx webhook,
    // static assets and files
    "/((?!p/|login|api/auth|api/telnyx|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
