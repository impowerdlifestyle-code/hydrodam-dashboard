import { NextResponse } from "next/server";
import { runAutomations } from "@/lib/automations";
import { hasSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Eight rules, each sweeping its own table and sending. The cap keeps any one
// run bounded, but a first run against a real backlog is not fast.
export const maxDuration = 300;

/**
 * The daily sweep.
 *
 * Two callers: Vercel Cron, which presents CRON_SECRET as a bearer token, and a
 * signed-in human asking for a dry run. A human can only ever force a dry run —
 * `?dry=1` is honoured, but nothing here lets a browser request turn sending ON
 * for an automation the owner has not armed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization") ?? "";
  const fromCron = Boolean(secret) && bearer === `Bearer ${secret}`;
  const fromOffice = await hasSession();

  if (!fromCron && !fromOffice) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // A human poking the endpoint gets a plan, never a send.
  const dryRun = !fromCron || url.searchParams.get("dry") === "1";
  const only = url.searchParams.get("only") ?? undefined;

  try {
    const results = await runAutomations({ dryRun, only });
    return NextResponse.json({
      ok: true,
      dryRun,
      at: new Date().toISOString(),
      totals: {
        due: results.reduce((s, r) => s + r.due, 0),
        sent: results.reduce((s, r) => s + r.sent, 0),
        suppressed: results.reduce((s, r) => s + r.suppressed, 0),
        errors: results.reduce((s, r) => s + r.errors, 0),
      },
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Run failed." },
      { status: 500 }
    );
  }
}
