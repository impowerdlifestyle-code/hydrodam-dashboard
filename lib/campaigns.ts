import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { TELNYX_LIVE, sendSms, segmentsFor, toE164 } from "@/lib/telnyx";

/**
 * One-off SMS campaigns the office writes and sends by hand. Same gates as
 * the automation engine, applied to a list the sender can see before anything
 * leaves: positive marketing consent, no STOP on file, quiet hours, a per-send
 * cap, and a message_sends reservation per recipient so a double-click cannot
 * text anyone twice.
 */

export const AUDIENCES = {
  all: "Everyone who opted in to marketing texts",
  customers: "Opted-in customers with a completed job",
  leads: "Opted-in leads without a job yet",
} as const;
export type Audience = keyof typeof AUDIENCES;

export const MAX_PER_SEND = 100;
const QUIET_START = 8 * 60;
const QUIET_END = 21 * 60;
const TZ = "America/New_York";
const OPT_OUT = "Reply STOP to opt out.";
export const AUTOMATION_ID = "campaign";

type ClientRow = { id: string; display_name: string; first_name: string | null; phone: string | null };

export type Recipient = { id: string; name: string; phone: string; text: string };
export type Plan = {
  recipients: Recipient[];
  skipped: Record<string, number>;
  segments: number;
  blocked?: string;
  text: string;
};

export type CampaignRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  sent: number;
  suppressed: number;
  errors: number;
  planned: { name?: string; audience?: Audience; text?: string; recipients?: number };
};

function minutesNowInTz(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function inQuietHours(now = new Date()): boolean {
  const mins = minutesNowInTz(now);
  return mins < QUIET_START || mins >= QUIET_END;
}

/** The opt-out line is a legal requirement, so the sender cannot forget it. */
export function withOptOut(text: string): string {
  const t = text.trim();
  return /\bstop\b/i.test(t) ? t : `${t} ${OPT_OUT}`;
}

function merge(text: string, c: ClientRow): string {
  const first = c.first_name?.trim() || c.display_name.split(" ")[0] || "there";
  return text.replace(/\{\{\s*first_name\s*\}\}/gi, first);
}

/** Why a send cannot happen at all, before any recipient is considered. */
export function sendBlocker(): string | undefined {
  if (!SUPABASE_LIVE) return "No database configured, so there is no audience to send to.";
  if (!TELNYX_LIVE) return "Telnyx is not configured on this deployment.";
  if (process.env.SMS_CARRIER_READY !== "1") return "Carrier registration is not marked complete, so texts would be filtered. Campaigns are held.";
  return undefined;
}

async function consented(channel: "sms_marketing" | "sms_transactional"): Promise<Set<string>> {
  const rows = await pg.select<{ client_id: string | null; granted: boolean }>("v_current_consent", {
    select: "client_id,granted",
    channel: `eq.${channel}`,
    limit: "5000",
  });
  return new Set(rows.filter((r) => r.granted && r.client_id).map((r) => r.client_id as string));
}

async function optedOutIds(): Promise<Set<string>> {
  const rows = await pg.select<{ client_id: string | null; granted: boolean }>("v_current_consent", {
    select: "client_id,granted",
    channel: "eq.sms_transactional",
    granted: "is.false",
    limit: "5000",
  });
  return new Set(rows.map((r) => r.client_id).filter(Boolean) as string[]);
}

async function customerIds(): Promise<Set<string>> {
  const rows = await pg.select<{ client_id: string }>("jobs", { select: "client_id", status: "eq.closed", limit: "5000" });
  return new Set(rows.map((r) => r.client_id));
}

export async function audienceCounts(): Promise<Record<Audience, number>> {
  if (!SUPABASE_LIVE) return { all: 0, customers: 0, leads: 0 };
  const [marketing, stopped, customers] = await Promise.all([consented("sms_marketing"), optedOutIds(), customerIds()]);
  const eligible = [...marketing].filter((id) => !stopped.has(id));
  const cust = eligible.filter((id) => customers.has(id)).length;
  return { all: eligible.length, customers: cust, leads: eligible.length - cust };
}

export async function planCampaign(audience: Audience, rawText: string): Promise<Plan> {
  const text = withOptOut(rawText);
  const plan: Plan = { recipients: [], skipped: {}, segments: segmentsFor(text).segments, text };
  const skip = (reason: string) => { plan.skipped[reason] = (plan.skipped[reason] ?? 0) + 1; };

  plan.blocked = sendBlocker();
  if (plan.blocked) return plan;

  const [marketing, stopped, customers] = await Promise.all([consented("sms_marketing"), optedOutIds(), customerIds()]);
  let ids = [...marketing].filter((id) => !stopped.has(id));
  plan.skipped.opted_out = [...marketing].filter((id) => stopped.has(id)).length || 0;
  if (!plan.skipped.opted_out) delete plan.skipped.opted_out;
  if (audience === "customers") ids = ids.filter((id) => customers.has(id));
  if (audience === "leads") ids = ids.filter((id) => !customers.has(id));
  if (ids.length === 0) return plan;

  const clients = await pg.select<ClientRow>("clients", {
    select: "id,display_name,first_name,phone",
    id: `in.(${ids.join(",")})`,
    archived_at: "is.null",
    order: "display_name.asc",
    limit: "5000",
  });

  for (const c of clients) {
    if (!c.phone) { skip("no_phone"); continue; }
    if (plan.recipients.length >= MAX_PER_SEND) { skip("cap_reached"); continue; }
    plan.recipients.push({ id: c.id, name: c.display_name, phone: toE164(c.phone), text: merge(text, c) });
  }
  return plan;
}

export type SendSummary = { ok: boolean; message: string; sent: number; failed: number; skipped: number };

export async function sendCampaign(name: string, audience: Audience, rawText: string): Promise<SendSummary> {
  const plan = await planCampaign(audience, rawText);
  if (plan.blocked) return { ok: false, message: plan.blocked, sent: 0, failed: 0, skipped: 0 };
  if (inQuietHours()) return { ok: false, message: "Outside quiet hours (8am to 9pm Eastern). Send it in the morning.", sent: 0, failed: 0, skipped: 0 };
  if (plan.recipients.length === 0) return { ok: false, message: "Nobody in that audience can be texted.", sent: 0, failed: 0, skipped: 0 };

  const company = await pg.rpc<string>("company_id", {});
  const [run] = await pg.insert<{ id: string }>("automation_runs", {
    company_id: company,
    automation_id: AUTOMATION_ID,
    armed: true,
    epoch_at: new Date().toISOString(),
    considered: plan.recipients.length,
    due: plan.recipients.length,
    planned: { name, audience, text: plan.text, recipients: plan.recipients.length },
  });
  if (!run) return { ok: false, message: "Could not open a campaign run.", sent: 0, failed: 0, skipped: 0 };

  let sent = 0, failed = 0, skipped = 0;
  const reasons: string[] = [];
  for (const r of plan.recipients) {
    let reservation: string | null = null;
    try {
      const [row] = await pg.insert<{ id: string }>("message_sends", {
        company_id: company,
        dedupe_key: `${AUTOMATION_ID}:${run.id}:client:${r.id}`,
        automation_id: AUTOMATION_ID,
        step_id: run.id,
        client_id: r.id,
        channel: "sms",
        status: "reserved",
        run_id: run.id,
      });
      reservation = row?.id ?? null;
    } catch {
      reservation = null;
    }
    if (!reservation) { skipped += 1; continue; }

    const res = await sendSms(r.phone, r.text);
    if (res.ok) {
      sent += 1;
      await pg.patch("message_sends", { id: `eq.${reservation}` }, { status: "sent", sent_at: new Date().toISOString() });
      await mirror(company, r, run.id, res.id);
    } else {
      failed += 1;
      if (reasons.length < 3) reasons.push(res.error);
      await pg.patch("message_sends", { id: `eq.${reservation}` }, { status: "failed", suppression_reason: res.error.slice(0, 200) });
    }
  }

  await pg.patch("automation_runs", { id: `eq.${run.id}` }, {
    finished_at: new Date().toISOString(),
    sent, errors: failed, suppressed: skipped,
    error: reasons.length ? reasons.join(" | ").slice(0, 500) : null,
  });

  const message = failed
    ? `Sent ${sent}, ${failed} failed. ${reasons[0] ?? ""}`.trim()
    : `Sent to ${sent} ${sent === 1 ? "person" : "people"}.`;
  return { ok: sent > 0, message, sent, failed, skipped };
}

/** Mirror into the Inbox so a reply lands on a thread that already shows what we said. */
async function mirror(company: string, r: Recipient, runId: string, providerId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const [conv] = await pg.insert<{ id: string }>(
      "conversations",
      { company_id: company, client_id: r.id, channel: "sms", external_address: r.phone, last_message_at: now, status: "open" },
      { onConflict: "company_id,channel,external_address" }
    );
    if (!conv) return;
    await pg.insert("messages", {
      company_id: company,
      conversation_id: conv.id,
      client_id: r.id,
      channel: "sms",
      direction: "outbound",
      status: "sent",
      from_address: process.env.TELNYX_FROM ?? "",
      to_address: r.phone,
      body_text: r.text,
      provider: "telnyx",
      provider_message_id: providerId,
      segments: segmentsFor(r.text).segments,
      template_key: AUTOMATION_ID,
      automation_id: AUTOMATION_ID,
      sent_at: now,
    });
  } catch {
    // The text went out. A failed mirror must not read as a failed send.
  }
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  if (!SUPABASE_LIVE) return [];
  return pg.select<CampaignRow>("automation_runs", {
    select: "id,started_at,finished_at,sent,suppressed,errors,planned",
    automation_id: `eq.${AUTOMATION_ID}`,
    order: "started_at.desc",
    limit: "25",
  });
}
