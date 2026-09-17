import { NextResponse } from "next/server";
import { syncQuickBooksEstimates } from "@/lib/quickbooks";
import { hasSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization") ?? "";
  const fromCron = Boolean(secret) && bearer === `Bearer ${secret}`;
  const fromOffice = await hasSession();

  if (!fromCron && !fromOffice) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const full = new URL(req.url).searchParams.get("full") === "1";
  const result = await syncQuickBooksEstimates({ full });
  return NextResponse.json(
    { ok: !result.error, at: new Date().toISOString(), ...result },
    { status: result.error ? 500 : 200 }
  );
}
