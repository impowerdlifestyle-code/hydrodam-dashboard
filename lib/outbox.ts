import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { clientName, db } from "@/lib/db";
import { hoursInTz, segmentsFor } from "@/lib/format";
import { seedSendAttempts } from "@/lib/seed";
import { requireSession } from "@/lib/session";
import { kindOf } from "@/lib/sms-copilot";
import type { Message } from "@/lib/types";

/**
 * What went out, and what tried to.
 *
 * Two views over the same rows. The Texts "Sent" list reads outbound SMS from
 * `messages`, whoever sent them. The Automations outbox reads `message_sends`,
 * which is where an automation or a campaign records every attempt, including
 * the ones a gate stopped, and joins the message it produced when there was
 * one. Everything is paged or capped: the tables hold thousands of rows.
 */

// ------------------------------------------------------------------ source

export const SOURCES = {
  copilot: "Copilot",
  automation: "Automation",
  campaign: "Campaign",
  inbox: "Inbox reply",
  lead_ack: "Lead acknowledgement",
  booking: "Booking confirmation",
  other: "Other",
} as const;
export type SourceKey = keyof typeof SOURCES;

/** Data from the CRM and config tables can carry dashes; the UI does not. */
const plain = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

export function automationName(key: string): string {
  if (key === "campaign") return "Campaign";
  return plain(db().automations.find((a) => a.key === key)?.name ?? key.replace(/_/g, " "));
}

/**
 * Where a text came from, from the two columns every writer stamps. The engine
 * and campaigns set automation_id; the copilot, intake and booking set only a
 * template key; an Inbox reply sets neither. Anything else is "Other" rather
 * than a guess.
 */
export function sourceOf(templateKey?: string | null, automationId?: string | null): { key: SourceKey; label: string } {
  if (automationId === "campaign") return { key: "campaign", label: SOURCES.campaign };
  if (automationId) return { key: "automation", label: `Automation: ${automationName(automationId)}` };
  if (templateKey?.startsWith("copilot_")) {
    const kind = templateKey.slice("copilot_".length);
    return { key: "copilot", label: `Copilot: ${kindOf(kind)?.label ?? kind.replace(/_/g, " ")}` };
  }
  if (templateKey === "speed_to_lead") return { key: "lead_ack", label: SOURCES.lead_ack };
  if (templateKey === "appointment_confirm") return { key: "booking", label: SOURCES.booking };
  if (!templateKey) return { key: "inbox", label: SOURCES.inbox };
  return { key: "other", label: SOURCES.other };
}

const SOURCE_FILTER: Record<SourceKey, Record<string, string>> = {
  campaign: { automation_id: "eq.campaign" },
  automation: { and: "(automation_id.not.is.null,automation_id.neq.campaign)" },
  copilot: { automation_id: "is.null", template_key: "like.copilot_*" },
  lead_ack: { automation_id: "is.null", template_key: "eq.speed_to_lead" },
  booking: { automation_id: "is.null", template_key: "eq.appointment_confirm" },
  inbox: { automation_id: "is.null", template_key: "is.null" },
  other: {
    automation_id: "is.null",
    and: "(template_key.not.is.null,template_key.not.like.copilot_*,template_key.not.in.(speed_to_lead,appointment_confirm))",
  },
};

// ---------------------------------------------------------------- delivery

export const DELIVERY = ["queued", "sent", "delivered", "failed"] as const;
export type Delivery = (typeof DELIVERY)[number];

const deliveryOf = (status: string | undefined): Delivery =>
  status === "delivered" ? "delivered"
  : status === "failed" || status === "bounced" ? "failed"
  : status === "sent" ? "sent"
  : "queued";

const DELIVERY_FILTER: Record<Delivery, string> = {
  queued: "in.(queued,sending)",
  sent: "eq.sent",
  delivered: "eq.delivered",
  failed: "in.(failed,bounced)",
};

// ------------------------------------------------------------------- range

export const RANGES = { today: "Today", "7d": "7 days", "30d": "30 days" } as const;
export type Range = keyof typeof RANGES;

/** Midnight in HydroDam's timezone, not the server's. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getTime() - hoursInTz(now.toISOString()) * 3_600_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

export function sinceFor(range: Range): string {
  if (range === "today") return startOfToday().toISOString();
  return new Date(Date.now() - (range === "7d" ? 7 : 30) * 86_400_000).toISOString();
}

// -------------------------------------------------------------- sent texts

export type OutboxRow = {
  id: string;
  at: string;
  clientId?: string;
  clientName: string;
  body: string;
  source: { key: SourceKey; label: string };
  segments: number;
  delivery: Delivery;
  error?: string;
};

type MessageRow = {
  id: string;
  created_at: string;
  client_id: string | null;
  body_text: string | null;
  template_key: string | null;
  automation_id: string | null;
  segments: number | null;
  status: string;
  error_message: string | null;
  clients: { display_name: string } | null;
};

const MESSAGE_COLS =
  "id,created_at,client_id,body_text,template_key,automation_id,segments,status,error_message,clients(display_name)";

const fromRow = (r: MessageRow): OutboxRow => ({
  id: r.id,
  at: r.created_at,
  clientId: r.client_id ?? undefined,
  clientName: r.clients?.display_name ?? "Unknown client",
  body: r.body_text ?? "",
  source: sourceOf(r.template_key, r.automation_id),
  segments: r.segments ?? segmentsFor(r.body_text ?? "").segments,
  delivery: deliveryOf(r.status),
  error: r.error_message ?? undefined,
});

const fromMessage = (m: Message): OutboxRow => ({
  id: m.id,
  at: m.createdAt,
  clientId: m.clientId || undefined,
  clientName: clientName(m.clientId),
  body: m.body,
  source: sourceOf(m.templateKey, m.automationId),
  segments: segmentsFor(m.body).segments,
  delivery: m.deliveryStatus ?? "queued",
  error: m.deliveryError,
});

const seedOutbound = () =>
  db().messages
    .filter((m) => m.channel === "sms" && m.direction === "outbound")
    .map(fromMessage)
    .sort((a, b) => b.at.localeCompare(a.at));

export type SentFilters = { source?: SourceKey; delivery?: Delivery; range: Range; page: number; pageSize: number };

export async function outboundTexts(f: SentFilters): Promise<{ rows: OutboxRow[]; total: number }> {
  await requireSession();
  const since = sinceFor(f.range);
  const offset = (f.page - 1) * f.pageSize;

  if (!SUPABASE_LIVE) {
    const all = seedOutbound().filter(
      (r) => r.at >= since && (!f.source || r.source.key === f.source) && (!f.delivery || r.delivery === f.delivery)
    );
    return { rows: all.slice(offset, offset + f.pageSize), total: all.length };
  }

  const { rows, total } = await pg.selectPage<MessageRow>(
    "messages",
    {
      select: MESSAGE_COLS,
      channel: "eq.sms",
      direction: "eq.outbound",
      created_at: `gte.${since}`,
      order: "created_at.desc",
      ...(f.source ? SOURCE_FILTER[f.source] : {}),
      ...(f.delivery ? { status: DELIVERY_FILTER[f.delivery] } : {}),
    },
    { limit: f.pageSize, offset }
  );
  return { rows: rows.map(fromRow), total };
}

export type SentStats = { today: number; week: number; deliveredPct: number | null; failedWeek: number };

export async function outboundStats(): Promise<SentStats> {
  await requireSession();
  const today = sinceFor("today");
  const week = sinceFor("7d");

  if (!SUPABASE_LIVE) {
    const all = seedOutbound();
    const wk = all.filter((r) => r.at >= week);
    const delivered = wk.filter((r) => r.delivery === "delivered").length;
    return {
      today: all.filter((r) => r.at >= today).length,
      week: wk.length,
      deliveredPct: wk.length ? Math.round((delivered / wk.length) * 100) : null,
      failedWeek: wk.filter((r) => r.delivery === "failed").length,
    };
  }

  const base = { channel: "eq.sms", direction: "eq.outbound" };
  const [t, w, d, x] = await Promise.all([
    pg.count("messages", { ...base, created_at: `gte.${today}` }),
    pg.count("messages", { ...base, created_at: `gte.${week}` }),
    pg.count("messages", { ...base, created_at: `gte.${week}`, status: DELIVERY_FILTER.delivered }),
    pg.count("messages", { ...base, created_at: `gte.${week}`, status: DELIVERY_FILTER.failed }),
  ]);
  return { today: t, week: w, deliveredPct: w ? Math.round((d / w) * 100) : null, failedWeek: x };
}

// ------------------------------------------------------- automation outbox

/** Why an attempt did not become a text, said the way you would say it to a customer's face. */
export const REASONS: Record<string, string> = {
  no_consent: "Not sent: they haven't agreed to texts yet",
  opted_out: "Not sent: they replied STOP",
  quiet_hours: "Held: outside texting hours (8am to 9pm)",
  cap_reached: "Held: this automation's daily limit was reached",
  no_10dlc_registration: "Not sent: phone carrier registration isn't finished yet",
  no_sms_key: "Not sent: texting isn't connected",
  no_mail_key: "Not sent: email isn't connected",
  no_template: "Not sent: there is no wording for this step",
  dry_run: "Not sent: the automation is turned off, this was a practice check",
  send_failed: "The phone company refused it",
};

export function reasonText(status: string, reason?: string): string | undefined {
  if (!reason) return undefined;
  if (REASONS[reason]) return REASONS[reason];
  return status === "failed" ? `The phone company refused it: ${reason}` : `Not sent: ${reason.replace(/_/g, " ")}`;
}

export type Attempt = {
  id: string;
  at: string;
  automationKey: string;
  automationName: string;
  clientId?: string;
  clientName: string;
  status: "reserved" | "sent" | "failed" | "suppressed";
  reason?: string;
  message?: OutboxRow;
};

type SendRow = {
  id: string;
  automation_id: string;
  client_id: string | null;
  status: Attempt["status"];
  suppression_reason: string | null;
  reserved_at: string;
  sent_at: string | null;
  message_id: string | null;
  clients: { display_name: string } | null;
};

/** The copilot reserves rows too, keyed copilot_<kind>. Those belong to Texts, not here. */
const NOT_COPILOT = "not.like.copilot_*";

export async function automationAttempts(opts: {
  key?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: Attempt[]; total: number }> {
  await requireSession();
  const offset = (opts.page - 1) * opts.pageSize;

  if (!SUPABASE_LIVE) {
    const byId = new Map(db().messages.map((m) => [m.id, m]));
    const all = seedSendAttempts()
      .filter((s) => !opts.key || s.automationKey === opts.key)
      .sort((a, b) => b.at.localeCompare(a.at));
    const rows = all.slice(offset, offset + opts.pageSize).map((s): Attempt => {
      const m = s.messageId ? byId.get(s.messageId) : undefined;
      return {
        id: s.id,
        at: s.at,
        automationKey: s.automationKey,
        automationName: automationName(s.automationKey),
        clientId: s.clientId,
        clientName: clientName(s.clientId),
        status: s.status,
        reason: s.reason,
        message: m ? fromMessage(m) : undefined,
      };
    });
    return { rows, total: all.length };
  }

  const { rows, total } = await pg.selectPage<SendRow>(
    "message_sends",
    {
      select: "id,automation_id,client_id,status,suppression_reason,reserved_at,sent_at,message_id,clients(display_name)",
      channel: "eq.sms",
      automation_id: opts.key ? `eq.${opts.key}` : NOT_COPILOT,
      order: "reserved_at.desc",
    },
    { limit: opts.pageSize, offset }
  );

  const messages = await messagesForSends(rows);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.sent_at ?? r.reserved_at,
      automationKey: r.automation_id,
      automationName: automationName(r.automation_id),
      clientId: r.client_id ?? undefined,
      clientName: r.clients?.display_name ?? "Unknown client",
      status: r.status,
      reason: r.suppression_reason ?? undefined,
      message: messages.get(r.id),
    })),
    total,
  };
}

/**
 * The text each sent row produced. Newer rows carry message_id; older engine
 * and campaign sends did not link it, so those are matched on the same
 * automation and client within ten minutes of the send, which is how the
 * engine wrote them: reserve, send, then mirror.
 */
async function messagesForSends(rows: SendRow[]): Promise<Map<string, OutboxRow>> {
  const out = new Map<string, OutboxRow>();
  const sent = rows.filter((r) => r.status === "sent");
  if (!sent.length) return out;

  const linked = sent.filter((r) => r.message_id).map((r) => r.message_id!);
  const unlinked = sent.filter((r) => !r.message_id && r.client_id);
  const oldest = sent.reduce((m, r) => ((r.sent_at ?? r.reserved_at) < m ? r.sent_at ?? r.reserved_at : m), new Date().toISOString());

  const [byId, loose] = await Promise.all([
    linked.length
      ? pg.select<MessageRow>("messages", { select: MESSAGE_COLS, id: `in.(${linked.join(",")})` })
      : Promise.resolve([]),
    unlinked.length
      ? pg.select<MessageRow & { automation_id: string }>("messages", {
          select: MESSAGE_COLS,
          channel: "eq.sms",
          direction: "eq.outbound",
          automation_id: `in.(${[...new Set(unlinked.map((r) => r.automation_id))].join(",")})`,
          client_id: `in.(${[...new Set(unlinked.map((r) => r.client_id!))].join(",")})`,
          created_at: `gte.${new Date(Date.parse(oldest) - 600_000).toISOString()}`,
          order: "created_at.desc",
          limit: "500",
        })
      : Promise.resolve([]),
  ]);

  const ids = new Map(byId.map((m) => [m.id, m]));
  for (const r of sent) {
    const direct = r.message_id ? ids.get(r.message_id) : undefined;
    const at = Date.parse(r.sent_at ?? r.reserved_at);
    const match =
      direct ??
      loose.find(
        (m) => m.automation_id === r.automation_id && m.client_id === r.client_id && Math.abs(Date.parse(m.created_at) - at) < 600_000
      );
    if (match) out.set(r.id, fromRow(match));
  }
  return out;
}

export type AttemptCounts = { sent: number; suppressed: number; failed: number };

/** Per automation, last seven days. Capped at 5,000 rows, which is weeks of the daily sweep. */
export async function attemptCounts7d(): Promise<Record<string, AttemptCounts>> {
  await requireSession();
  const since = sinceFor("7d");
  const rows = SUPABASE_LIVE
    ? await pg.select<{ automation_id: string; status: string }>("message_sends", {
        select: "automation_id,status",
        channel: "eq.sms",
        automation_id: NOT_COPILOT,
        reserved_at: `gte.${since}`,
        limit: "5000",
      })
    : seedSendAttempts().filter((s) => s.at >= since).map((s) => ({ automation_id: s.automationKey, status: s.status }));

  const out: Record<string, AttemptCounts> = {};
  for (const r of rows) {
    const c = (out[r.automation_id] ??= { sent: 0, suppressed: 0, failed: 0 });
    if (r.status === "sent") c.sent += 1;
    else if (r.status === "suppressed") c.suppressed += 1;
    else if (r.status === "failed") c.failed += 1;
  }
  return out;
}

/**
 * Sent in the last seven days by the texts that fire from one event rather
 * than the sweep. They write no message_sends row, so only sends are countable.
 */
export async function builtInSent7d(): Promise<Record<string, number>> {
  await requireSession();
  const since = sinceFor("7d");
  const keys = { lead_ack: "speed_to_lead", appointment_confirm: "appointment_confirm" };
  const out: Record<string, number> = {};
  for (const [flow, templateKey] of Object.entries(keys)) {
    out[flow] = SUPABASE_LIVE
      ? await pg.count("messages", {
          channel: "eq.sms", direction: "eq.outbound", automation_id: "is.null",
          template_key: `eq.${templateKey}`, created_at: `gte.${since}`,
        })
      : seedOutbound().filter((r) => r.at >= since && r.source.key === (flow === "lead_ack" ? "lead_ack" : "booking")).length;
  }
  return out;
}
