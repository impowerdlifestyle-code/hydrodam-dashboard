import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { MAIL_LIVE, sendEmail } from "@/lib/mail";
import { render } from "@/lib/templates";
import { TELNYX_LIVE, sendSms, segmentsFor, toE164 } from "@/lib/telnyx";

/**
 * The automation engine.
 *
 * The CRM carries ~3,000 dormant contacts. A naive "everyone with status X"
 * cron mails a four-figure list on its first run and burns the sending domain
 * for every real customer. Four gates prevent that, they live in data so they
 * are auditable, and none of them may be weakened:
 *
 *   1. epoch     — nothing older than epoch_at is ever eligible. Null = nothing
 *                  sends, at all, whatever else is true.
 *   2. exact-day — offsets are matched exactly. Three days past due is not
 *                  "due", so a backlog can never flush in one run.
 *   3. dedupe    — a message_sends row is reserved BEFORE the provider call, on
 *                  a unique key. Two concurrent crons cannot double-send.
 *   4. armed     — false produces a plan and sends nothing.
 *
 * Plus a per-run cap and quiet hours. A dry run deliberately does NOT reserve,
 * so arming later still sends what the dry run listed.
 */

const TZ = "America/New_York";

/** Today where the customer lives, not where the lambda runs. */
export function todayInTz(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function minutesNowInTz(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const dateOnly = (iso: string): string => todayInTz(new Date(iso));

/** Whole days from anchor to today. Both are dates, so DST cannot shift it. */
function daysSince(anchorDate: string, today: string): number {
  const a = Date.parse(`${anchorDate}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  return Math.round((t - a) / 86_400_000);
}

const hhmmToMinutes = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

// ------------------------------------------------------------------- types

type ClientRow = {
  id: string;
  display_name: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
};

type ConfigRow = {
  id: string;
  automation_id: string;
  name: string;
  trigger_event: string;
  epoch_at: string | null;
  armed: boolean;
  max_sends_per_run: number;
  offsets_days: number[];
  channels: ("sms" | "email")[];
  quiet_hours_start: string;
  quiet_hours_end: string;
  requires_consent: string | null;
};

export type Candidate = {
  dedupeKey: string;
  client: ClientRow;
  anchorDate: string;
  offset: number;
  entity: { requestId?: string; visitId?: string; jobId?: string; quoteId?: string; invoiceId?: string };
  context: Record<string, unknown>;
  label: string;
};

export type RunSummary = {
  automationId: string;
  name: string;
  armed: boolean;
  considered: number;
  due: number;
  sent: number;
  suppressed: number;
  errors: number;
  reasons: Record<string, number>;
  planned: { to: string; channel: string; label: string; dedupeKey: string }[];
};

// -------------------------------------------------------------- candidates

const CLIENT_COLS = "id,display_name,first_name,email,phone";

/**
 * Each rule answers one question: which rows are anchored to a date, and what
 * does the message need to say about them. The gates are applied uniformly
 * afterwards, so a rule cannot accidentally opt out of one.
 */
async function candidatesFor(cfg: ConfigRow, epoch: string): Promise<Candidate[]> {
  const out: Candidate[] = [];

  const push = (
    c: ClientRow | null | undefined,
    anchorISO: string | null,
    entity: Candidate["entity"],
    context: Record<string, unknown>,
    label: string,
    keyPart: string
  ) => {
    if (!c || !anchorISO) return;
    const anchorDate = dateOnly(anchorISO);
    for (const offset of cfg.offsets_days) {
      out.push({
        dedupeKey: `${cfg.automation_id}:${keyPart}:${offset}`,
        client: c,
        anchorDate,
        offset,
        entity,
        context,
        label,
      });
    }
  };

  switch (cfg.automation_id) {
    case "speed_to_lead": {
      const rows = await pg.select<{
        id: string; number: number; created_at: string; first_response_at: string | null;
        clients: ClientRow | null;
      }>("requests", {
        select: `id,number,created_at,first_response_at,clients(${CLIENT_COLS})`,
        status: "eq.new",
        first_response_at: "is.null",
        created_at: `gte.${epoch}`,
        order: "created_at.desc",
        limit: "500",
      });
      for (const r of rows) {
        push(r.clients, r.created_at, { requestId: r.id }, {}, `request #${r.number}`, `request:${r.id}`);
      }
      break;
    }

    case "reminder_24h": {
      const rows = await pg.select<{
        id: string; scheduled_start: string | null; scheduled_end: string | null;
        clients: ClientRow | null; properties: { address_line1: string; city: string } | null;
      }>("visits", {
        select: `id,scheduled_start,scheduled_end,clients(${CLIENT_COLS}),properties(address_line1,city)`,
        status: "in.(scheduled,confirmed)",
        scheduled_start: `gte.${epoch}`,
        order: "scheduled_start.asc",
        limit: "500",
      });
      for (const v of rows) {
        if (!v.scheduled_start) continue;
        push(
          v.clients,
          v.scheduled_start,
          { visitId: v.id },
          {
            visitWindow: windowLabel(v.scheduled_start, v.scheduled_end),
            address: v.properties ? `${v.properties.address_line1}, ${v.properties.city}` : undefined,
          },
          "visit reminder",
          `visit:${v.id}`
        );
      }
      break;
    }

    case "quote_followup": {
      const rows = await pg.select<{
        id: string; number: number; total_cents: number; sent_at: string | null;
        clients: ClientRow | null;
      }>("quotes", {
        select: `id,number,total_cents,sent_at,clients(${CLIENT_COLS})`,
        status: "in.(sent,viewed)",
        sent_at: `gte.${epoch}`,
        order: "sent_at.desc",
        limit: "500",
      });
      for (const q of rows) {
        push(
          q.clients, q.sent_at, { quoteId: q.id },
          { quoteNumber: q.number, quoteTotalCents: q.total_cents },
          `quote #${q.number}`, `quote:${q.id}`
        );
      }
      break;
    }

    case "invoice_reminders": {
      const rows = await pg.select<{
        id: string; number: number; balance_cents: number; due_date: string | null;
        sent_at: string | null; clients: ClientRow | null;
      }>("invoices", {
        select: `id,number,balance_cents,due_date,sent_at,clients(${CLIENT_COLS})`,
        status: "in.(sent,viewed,partially_paid)",
        balance_cents: "gt.0",
        sent_at: `gte.${epoch}`,
        order: "due_date.asc",
        limit: "500",
      });
      for (const i of rows) {
        if (!i.due_date) continue;
        // Anchored on the due date, so -3 is a courtesy note and +14 is a chase.
        push(
          i.clients, `${i.due_date}T12:00:00Z`, { invoiceId: i.id },
          {
            invoiceNumber: i.number,
            balanceCents: i.balance_cents,
            dueDate: i.due_date,
            daysOverdue: daysSince(i.due_date, todayInTz()),
          },
          `invoice #${i.number}`, `invoice:${i.id}`
        );
      }
      break;
    }

    case "review_request": {
      const rows = await pg.select<{
        id: string; number: number; closed_at: string | null; clients: ClientRow | null;
      }>("jobs", {
        select: `id,number,closed_at,clients(${CLIENT_COLS})`,
        status: "eq.closed",
        closed_at: `gte.${epoch}`,
        order: "closed_at.desc",
        limit: "500",
      });
      for (const j of rows) {
        push(j.clients, j.closed_at, { jobId: j.id }, {}, `job #${j.number}`, `job:${j.id}`);
      }
      break;
    }

    // Reaching three thousand dormant leads is exactly the blast this engine
    // exists to prevent, so it is consent-gated in config and the query only
    // ever returns people who granted it. Today that is nobody.
    case "dormant_nurture": {
      const consents = await pg.select<{ client_id: string | null }>("v_current_consent", {
        select: "client_id",
        channel: "eq.email_marketing",
        granted: "is.true",
        limit: "1000",
      });
      const ids = consents.map((c) => c.client_id).filter(Boolean) as string[];
      if (ids.length === 0) break;

      const rows = await pg.select<{
        id: string; created_at: string; clients: ClientRow | null;
      }>("requests", {
        select: `id,created_at,clients(${CLIENT_COLS})`,
        status: "in.(contacted,assessed)",
        client_id: `in.(${ids.join(",")})`,
        created_at: `gte.${epoch}`,
        limit: "500",
      });
      for (const r of rows) {
        push(r.clients, r.created_at, { requestId: r.id }, {}, "dormant lead", `lead:${r.id}`);
      }
      break;
    }

    // on_my_way fires from the visit status change, not from a daily sweep, and
    // storm_surge is fired by a human watching a forecast. Neither has anything
    // for a cron to find.
    default:
      break;
  }

  return out;
}

function windowLabel(startISO: string, endISO: string | null): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return endISO ? `${fmt(startISO)}–${fmt(endISO)}` : fmt(startISO);
}

// --------------------------------------------------------------------- run

export type RunOptions = {
  /** Forces a plan-only pass even for an armed automation. */
  dryRun?: boolean;
  only?: string;
};

export async function runAutomations(opts: RunOptions = {}): Promise<RunSummary[]> {
  if (!SUPABASE_LIVE) throw new Error("No database configured.");

  const company = await pg.rpc<string>("company_id", {});
  const configs = await pg.select<ConfigRow>("automation_config", {
    select:
      "id,automation_id,name,trigger_event,epoch_at,armed,max_sends_per_run,offsets_days,channels,quiet_hours_start,quiet_hours_end,requires_consent",
    order: "created_at.asc",
  });

  const today = todayInTz();
  const nowMinutes = minutesNowInTz();
  const summaries: RunSummary[] = [];

  for (const cfg of configs) {
    if (opts.only && cfg.automation_id !== opts.only) continue;

    const armed = cfg.armed && !opts.dryRun;
    const summary: RunSummary = {
      automationId: cfg.automation_id,
      name: cfg.name,
      armed,
      considered: 0, due: 0, sent: 0, suppressed: 0, errors: 0,
      reasons: {}, planned: [],
    };
    const note = (reason: string) => {
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    };

    // GATE 1. No epoch means nothing is eligible — not "everything since the
    // beginning of time", which is the failure mode this prevents.
    if (!cfg.epoch_at) {
      summary.reasons.no_epoch = 1;
      summaries.push(summary);
      continue;
    }

    const [runRow] = await pg.insert<{ id: string }>("automation_runs", {
      company_id: company,
      automation_id: cfg.automation_id,
      armed,
      epoch_at: cfg.epoch_at,
    });

    try {
      const candidates = await candidatesFor(cfg, cfg.epoch_at);
      summary.considered = candidates.length;

      const quiet =
        nowMinutes < hhmmToMinutes(cfg.quiet_hours_start) ||
        nowMinutes >= hhmmToMinutes(cfg.quiet_hours_end);

      for (const cand of candidates) {
        // GATE 2. Exact-day. A missed run does not flush tomorrow.
        if (daysSince(cand.anchorDate, today) !== cand.offset) continue;
        summary.due += 1;

        if (summary.sent >= cfg.max_sends_per_run) {
          note("cap_reached");
          summary.suppressed += 1;
          continue;
        }

        // Checked BEFORE reserving: a key reserved now and suppressed would
        // never send, so quiet hours would silently cancel the message rather
        // than delay it.
        if (quiet) {
          note("quiet_hours");
          summary.suppressed += 1;
          continue;
        }

        const channel = await pickChannel(cfg, cand);
        if (!channel.ok) {
          note(channel.reason);
          summary.suppressed += 1;
          continue;
        }

        const rendered = render(cfg.automation_id, {
          firstName: firstNameOf(cand.client),
          companyPhone: "(727) 613-1415",
          ...cand.context,
        });
        if (!rendered) {
          note("no_template");
          summary.suppressed += 1;
          continue;
        }

        summary.planned.push({
          to: channel.address,
          channel: channel.channel,
          label: cand.label,
          dedupeKey: cand.dedupeKey,
        });

        // GATE 4. A dry run stops here, deliberately without reserving.
        if (!armed) {
          summary.suppressed += 1;
          note("dry_run");
          continue;
        }

        // GATE 3. Reserve first. A duplicate key means another run already has
        // this one, and the insert failing is the whole point.
        const reservation = await reserve(company, cfg, cand, channel.channel, runRow?.id);
        if (!reservation) {
          note("already_sent");
          continue;
        }

        const result =
          channel.channel === "email"
            ? await sendEmail({ to: channel.address, subject: rendered.subject, html: rendered.html })
            : await sendSms(channel.address, rendered.sms);

        if ("ok" in result && result.ok) {
          await pg.patch("message_sends", { id: `eq.${reservation}` }, {
            status: "sent",
            sent_at: new Date().toISOString(),
          });
          await recordMessage(company, cfg, cand, channel, rendered);
          summary.sent += 1;
        } else {
          // Failed rows fall outside the dedupe index, so the next run retries.
          await pg.patch("message_sends", { id: `eq.${reservation}` }, {
            status: "failed",
            suppression_reason: ("error" in result ? result.error : "send failed")?.slice(0, 200),
          });
          summary.errors += 1;
          note("send_failed");
        }
      }
    } catch (e) {
      summary.errors += 1;
      note(e instanceof Error ? e.message.slice(0, 120) : "unknown");
    }

    if (runRow) {
      await pg.patch("automation_runs", { id: `eq.${runRow.id}` }, {
        finished_at: new Date().toISOString(),
        considered: summary.considered,
        due: summary.due,
        sent: summary.sent,
        suppressed: summary.suppressed,
        errors: summary.errors,
        planned: summary.planned,
      });
    }

    summaries.push(summary);
  }

  return summaries;
}

const firstNameOf = (c: ClientRow): string =>
  (c.first_name?.trim() || c.display_name.split(" ")[0] || "there").trim();

type Channel =
  | { ok: true; channel: "email" | "sms"; address: string }
  | { ok: false; reason: string };

/**
 * Email is preferred wherever an address exists: it is free, it is unregulated
 * relative to SMS, and HydroDam's domain is verified. SMS is the fallback and
 * carries every consent obligation with it.
 */
async function pickChannel(cfg: ConfigRow, cand: Candidate): Promise<Channel> {
  const wantsEmail = cfg.channels.includes("email");
  const wantsSms = cfg.channels.includes("sms");

  if (wantsEmail && cand.client.email) {
    if (!MAIL_LIVE) return { ok: false, reason: "no_mail_key" };
    if (cfg.requires_consent === "email_marketing" && !(await hasConsent(cand.client.id, "email_marketing"))) {
      return { ok: false, reason: "no_consent" };
    }
    return { ok: true, channel: "email", address: cand.client.email };
  }

  if (wantsSms && cand.client.phone) {
    if (!TELNYX_LIVE) return { ok: false, reason: "no_sms_key" };
    // Hydro Dam LLC has no 10DLC brand or campaign, so a message to a real
    // wireless number is carrier-filtered. Recording that as a suppression is
    // honest; pretending it sent is not.
    if (process.env.SMS_CARRIER_READY !== "1") return { ok: false, reason: "no_10dlc_registration" };
    const marketing = cfg.requires_consent === "sms_marketing";
    if (marketing && !(await hasConsent(cand.client.id, "sms_marketing"))) {
      return { ok: false, reason: "no_consent" };
    }
    if (await optedOut(cand.client.id)) return { ok: false, reason: "opted_out" };
    return { ok: true, channel: "sms", address: toE164(cand.client.phone) };
  }

  return { ok: false, reason: cand.client.email || cand.client.phone ? "channel_unavailable" : "no_address" };
}

async function hasConsent(clientId: string, channel: string): Promise<boolean> {
  const [row] = await pg.select<{ granted: boolean }>("v_current_consent", {
    select: "granted", client_id: `eq.${clientId}`, channel: `eq.${channel}`, limit: "1",
  });
  return Boolean(row?.granted);
}

/** STOP revokes transactional too, and that is a hard block on every send. */
async function optedOut(clientId: string): Promise<boolean> {
  const [row] = await pg.select<{ granted: boolean }>("v_current_consent", {
    select: "granted", client_id: `eq.${clientId}`, channel: "eq.sms_transactional", limit: "1",
  });
  return row ? !row.granted : false;
}

async function reserve(
  company: string,
  cfg: ConfigRow,
  cand: Candidate,
  channel: "email" | "sms",
  runId?: string
): Promise<string | null> {
  try {
    const [row] = await pg.insert<{ id: string }>("message_sends", {
      company_id: company,
      dedupe_key: cand.dedupeKey,
      automation_id: cfg.automation_id,
      step_id: String(cand.offset),
      occurrence: cand.offset,
      client_id: cand.client.id,
      visit_id: cand.entity.visitId ?? null,
      job_id: cand.entity.jobId ?? null,
      channel,
      anchor_date: cand.anchorDate,
      status: "reserved",
      run_id: runId ?? null,
    });
    return row?.id ?? null;
  } catch {
    // 23505 on the dedupe index: somebody already has this one.
    return null;
  }
}

/** Mirrors the send into the Inbox so the office sees what the robot said. */
async function recordMessage(
  company: string,
  cfg: ConfigRow,
  cand: Candidate,
  channel: { channel: "email" | "sms"; address: string },
  rendered: { subject: string; html: string; sms: string }
): Promise<void> {
  try {
    const [conv] = await pg.insert<{ id: string }>(
      "conversations",
      {
        company_id: company,
        client_id: cand.client.id,
        channel: channel.channel,
        external_address: channel.address,
        subject: channel.channel === "email" ? rendered.subject : null,
        last_message_at: new Date().toISOString(),
        status: "open",
      },
      { onConflict: "company_id,channel,external_address" }
    );
    if (!conv) return;

    await pg.insert("messages", {
      company_id: company,
      conversation_id: conv.id,
      client_id: cand.client.id,
      channel: channel.channel,
      direction: "outbound",
      status: "sent",
      from_address: channel.channel === "email" ? (process.env.MAIL_FROM ?? "info@thehydrodam.com") : (process.env.TELNYX_FROM ?? ""),
      to_address: channel.address,
      subject: channel.channel === "email" ? rendered.subject : null,
      body_text: channel.channel === "email" ? rendered.subject : rendered.sms,
      body_html: channel.channel === "email" ? rendered.html : null,
      provider: channel.channel === "email" ? "resend" : "telnyx",
      segments: channel.channel === "sms" ? segmentsFor(rendered.sms).segments : null,
      template_key: cfg.automation_id,
      automation_id: cfg.automation_id,
      sent_at: new Date().toISOString(),
    });
  } catch {
    // The message went out. Failing to mirror it must not look like a failure
    // to send, or the next run would send it again.
  }
}
