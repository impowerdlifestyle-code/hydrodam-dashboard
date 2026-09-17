import { NextResponse } from "next/server";
import { QB_CONFIGURED, qbAuthorizeUrl } from "@/lib/quickbooks";
import { hasSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!QB_CONFIGURED) return NextResponse.redirect(new URL("/quickbooks?error=not_configured", req.url));

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(qbAuthorizeUrl(state));
  res.cookies.set("qb_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });
  return res;
}
