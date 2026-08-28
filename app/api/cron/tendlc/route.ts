import { NextResponse } from "next/server";
import { hasSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Assigns +1 727-351-8152 to the 10DLC campaign the moment the carriers approve it.
 *
 * This used to be a launchd job on a laptop — on the MacBook Air, specifically,
 * which was decommissioned in August. A registration that unblocks every
 * outbound SMS should not be waiting on whether a particular machine happens to
 * be awake, so it runs here instead.
 *
 * It does not try to read approval out of `campaignStatus`. That enum is
 * undocumented and has already misled us twice: `status: ACTIVE` on a campaign
 * Telnyx had rejected, and `TELNYX_FAILED` logged for six days as though it
 * were an ordinary queue wait. The assignment attempt is the test — 10036 means
 * keep waiting, a clean response means done.
 */
const CAMPAIGN_ID = "4b3001a0-185c-263b-31a6-c1ca1f05c12a";
const NUMBER = "+17273518152";
const DEAD = new Set(["TELNYX_FAILED", "TCR_FAILED", "MNO_REJECTED", "EXPIRED", "DEACTIVATED"]);

async function telnyx(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.telnyx.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY ?? ""}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return res.json().catch(() => ({}));
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const fromCron = Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!fromCron && !(await hasSession())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.TELNYX_API_KEY) {
    return NextResponse.json({ ok: false, error: "TELNYX_API_KEY unset." }, { status: 500 });
  }

  const campaign = await telnyx(`/10dlc/campaign/${CAMPAIGN_ID}`);
  const campaignStatus: string = campaign?.campaignStatus ?? "unknown";
  // failureReasons records the last completed review pass and does not clear on
  // resubmission, so it is only meaningful alongside a dead status.
  const reasons = (campaign?.failureReasons ?? []).map(
    (r: { description?: string }) => r.description,
  );

  if (DEAD.has(campaignStatus)) {
    return NextResponse.json({ ok: false, state: "rejected", campaignStatus, reasons });
  }

  const assign = await telnyx("/10dlc/phone_number_campaigns", {
    method: "POST",
    body: JSON.stringify({ phoneNumber: NUMBER, campaignId: CAMPAIGN_ID }),
  });
  const errors: { code?: string | number; detail?: string }[] = assign?.errors ?? [];

  if (!errors.length) {
    return NextResponse.json({ ok: true, state: "assigned", campaignStatus, number: NUMBER });
  }
  if (String(errors[0]?.code) === "10036") {
    return NextResponse.json({ ok: true, state: "waiting", campaignStatus });
  }
  return NextResponse.json({ ok: false, state: "error", campaignStatus, errors });
}
