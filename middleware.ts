import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hd_session";
const sessionSecret = () => process.env.SESSION_SECRET ?? "hydrodam-ops-dev";

export function middleware(req: NextRequest) {
  // Open access while AUTH_DISABLED is set — remove the env var to re-lock.
  if (process.env.AUTH_DISABLED === "1") return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token === sessionSecret()) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Protect everything except the login page, the auth route, and static assets.
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
