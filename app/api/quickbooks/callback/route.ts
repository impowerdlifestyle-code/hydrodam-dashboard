import { NextResponse, type NextRequest } from "next/server";
import { qbExchangeCode, syncQuickBooksEstimates } from "@/lib/quickbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Intuit sends the browser back here after Mady approves the connection. The
 * session cookie is not guaranteed on this hop, so the `qb_state` cookie set
 * by /connect is the credential: it only exists if a signed-in office user
 * started the flow within the last ten minutes.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/quickbooks?${query}`, req.url));
    res.cookies.delete("qb_state");
    return res;
  };

  const expected = req.cookies.get("qb_state")?.value;
  const state = params.get("state");
  if (!expected || !state || state !== expected) return back("error=state");

  const denied = params.get("error");
  if (denied) return back(`error=${encodeURIComponent(denied)}`);

  const code = params.get("code");
  const realmId = params.get("realmId");
  if (!code || !realmId) return back("error=missing_code");

  try {
    await qbExchangeCode(code, realmId);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 120) : "exchange_failed";
    return back(`error=${encodeURIComponent(msg)}`);
  }

  await syncQuickBooksEstimates({ full: true });
  return back("connected=1");
}
