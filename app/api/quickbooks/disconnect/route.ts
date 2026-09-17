import { NextResponse } from "next/server";
import { qbDisconnect } from "@/lib/quickbooks";
import { hasSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  await qbDisconnect();
  return NextResponse.redirect(new URL("/quickbooks?disconnected=1", req.url), 303);
}
