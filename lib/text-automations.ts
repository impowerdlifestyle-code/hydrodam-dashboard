import "server-only";
import { createHash } from "node:crypto";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { db, invalidate } from "@/lib/db";
import { fill, render, type TemplateContext } from "@/lib/templates";
import { SAMPLE, describeTiming, toFriendly, withOptOutLine } from "@/lib/sms-wording";
import type { Automation } from "@/lib/types";

/**
 * Every flow that can send a text on its own, described for the people who
 * run the office rather than the people who wrote the engine.
 *
 * Two families. Engine automations are rows in automation_config: the daily
 * sweep finds who is due, and each can be switched on or off and retimed.
 * Built-in texts fire from a single event (a website form, a portal booking)
 * and are always on while texting is connected.
 *
 * Wording can be overridden per flow. The override is a builder_items row
 * (kind template, key automation_sms:<key>), so it needs no new table, and
 * with none saved the built-in wording is what sends.
 */

type Meta = {
  what: string;
  who: string;
  /** What the day offsets count from, in words. Absent when the flow has no delay. */
  anchor?: string;
  /** Whether negative offsets make sense (before the anchor). */
  before?: boolean;
  after?: boolean;
  tokens: string[];
  starter: string;
  /** False when nothing in the app fires it yet. */
  wired: boolean;
};

const BASE = ["first_name", "company_phone"];

const META: Record<string, Meta> = {
  speed_to_lead: {
    what: "A first hello to a new lead that nobody has replied to yet.",
    who: "Anyone whose request is still marked New with no reply logged.",
    anchor: "the day the request came in",
    after: true,
    tokens: BASE,
    starter: "Hi {{first_name}}, HydroDam here. We have your flood barrier enquiry and will call within one business day to book your free assessment. Questions? {{company_phone}}",
    wired: true,
  },
  reminder_24h: {
    what: "A reminder about a visit that is on the calendar.",
    who: "Customers with a scheduled or confirmed visit.",
    anchor: "the day of the visit",
    before: true,
    tokens: [...BASE, "visit_window", "address"],
    starter: "HydroDam reminder: we're with you tomorrow {{visit_window}}. Please clear access to the openings. Need to move it? {{company_phone}}",
    wired: true,
  },
  on_my_way: {
    what: "Tells the customer the crew is on the way.",
    who: "The customer on a visit when the crew heads out.",
    tokens: BASE,
    starter: "HydroDam: your crew is on the way to you now. {{company_phone}}",
    wired: false,
  },
  quote_followup: {
    what: "Checks in on a quote the customer has not answered.",
    who: "Customers with a quote that is sent or viewed but not approved.",
    anchor: "the day the quote was sent",
    after: true,
    tokens: [...BASE, "quote_number", "quote_total"],
    starter: "HydroDam: checking in on your quote #{{quote_number}}. Anything you'd like explained or adjusted? {{company_phone}}",
    wired: true,
  },
  invoice_reminders: {
    what: "A friendly note before an invoice is due, then reminders if it is still unpaid.",
    who: "Customers with an invoice that still has a balance.",
    anchor: "the invoice due date",
    before: true,
    after: true,
    tokens: [...BASE, "invoice_number", "balance", "due_date", "days_overdue"],
    starter: "HydroDam: invoice #{{invoice_number}} for {{balance}} is outstanding. Already paid? Let us know. {{company_phone}}",
    wired: true,
  },
  review_request: {
    what: "Asks a happy customer for a Google review.",
    who: "Customers whose job has been closed.",
    anchor: "the day the job was closed",
    after: true,
    tokens: BASE,
    starter: "HydroDam: hope you're happy with your barriers. A quick review helps your neighbours find us. Anything not right? Just reply.",
    wired: true,
  },
  storm_surge: {
    what: "A storm alert telling customers to put their barriers up.",
    who: "Customers who agreed to marketing texts.",
    tokens: BASE,
    starter: "HydroDam storm watch: deploy your barriers now, not the night before. Need a hand? {{company_phone}}",
    wired: false,
  },
};

/** What a team-built automation's trigger means, and which fields it can fill. */
const BY_TRIGGER: Record<string, Pick<Meta, "who" | "anchor" | "before" | "after" | "tokens">> = {
  "request.created": { who: "New leads with an open request.", anchor: "the day the request came in", after: true, tokens: BASE },
  "visit.scheduled": { who: "Customers with a visit on the calendar.", anchor: "the day of the visit", before: true, tokens: [...BASE, "visit_window", "address"] },
  "quote.sent": { who: "Customers with an unanswered quote.", anchor: "the day the quote was sent", after: true, tokens: [...BASE, "quote_number", "quote_total"] },
  "invoice.sent": { who: "Customers with an unpaid invoice.", anchor: "the invoice due date", before: true, after: true, tokens: [...BASE, "invoice_number", "balance", "due_date", "days_overdue"] },
  "job.closed": { who: "Customers whose job has been closed.", anchor: "the day the job was closed", after: true, tokens: BASE },
  "lead.status_changed": { who: "Leads that went quiet and agreed to marketing.", anchor: "the day they went quiet", after: true, tokens: BASE },
};

const BUILT_IN: Record<string, { name: string; what: string; who: string; when: string; tokens: string[]; starter: string; sample: () => string }> = {
  lead_ack: {
    name: "Reply to a website enquiry",
    what: "Thanks someone for filling in the website form and tells them what happens next.",
    who: "New website leads who ticked the box agreeing to texts.",
    when: "Straight away when the form is sent. Outside 8am to 9pm it is skipped, not saved for later.",
    tokens: [...BASE, "portal_url"],
    starter: "Hi {{first_name}}, HydroDam here. We have your flood barrier enquiry and will call within one business day to book your free assessment. Or book online: {{portal_url}} Questions? {{company_phone}}",
    sample: () => render("speed_to_lead", sampleCtx())?.sms ?? "",
  },
  appointment_confirm: {
    name: "Assessment booking confirmation",
    what: "Confirms the date and time when a customer books their assessment from their portal.",
    who: "Customers who book their own assessment online.",
    when: "Straight away when they book. Outside 8am to 9pm it is skipped, not saved for later.",
    tokens: [...BASE, "visit_date", "visit_window", "address"],
    starter: "HydroDam: you're booked for {{visit_date}}, {{visit_window}} at {{address}}. About an hour. Need to change it? {{company_phone}}",
    sample: () => bookingText(sampleCtx()),
  },
};

export function sampleCtx(): TemplateContext {
  return {
    firstName: SAMPLE.first_name,
    companyPhone: SAMPLE.company_phone,
    visitDate: SAMPLE.visit_date,
    visitWindow: SAMPLE.visit_window,
    address: SAMPLE.address,
    quoteNumber: Number(SAMPLE.quote_number),
    quoteTotalCents: 185_000,
    invoiceNumber: Number(SAMPLE.invoice_number),
    balanceCents: 92_500,
    dueDate: SAMPLE.due_date,
    daysOverdue: Number(SAMPLE.days_overdue),
    portalUrl: SAMPLE.portal_url,
  };
}

/** The booking confirmation as it has always read, when nobody has changed it. */
export function bookingText(c: TemplateContext): string {
  return `HydroDam: you're booked for ${c.visitDate ?? ""}${c.visitWindow ? `, ${c.visitWindow}` : ""}${c.address ? ` at ${c.address}` : ""}. About an hour. Need to change it? ${c.companyPhone}`;
}

// ------------------------------------------------------------------ catalog

export type TextFlow = {
  key: string;
  name: string;
  family: "automation" | "built_in";
  automation?: Automation;
  what: string;
  who: string;
  when: string;
  anchor?: string;
  before: boolean;
  after: boolean;
  marketing: boolean;
  /** Email goes first when the automation has both channels and we have an address. */
  emailFirst: boolean;
  wired: boolean;
  on: boolean;
  tokens: string[];
  starter: string;
  override?: Override;
  /** What goes out today for the sample customer. */
  current: string;
};

const plain = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

export async function textFlows(): Promise<TextFlow[]> {
  const overrides = await loadOverrides();
  const ctx = sampleCtx();

  const engine = db()
    .automations.filter((a) => a.channels.includes("sms"))
    .map((a): TextFlow => {
      const meta = META[a.key];
      const trig = BY_TRIGGER[a.trigger];
      const marketing = a.requiresConsent === "sms_marketing";
      const override = overrides[a.key];
      const anchor = meta ? meta.anchor : trig?.anchor;
      const builtIn = render(a.key, ctx)?.sms ?? "";
      const text = override ? fill(override.body, ctx) : builtIn;
      return {
        key: a.key,
        name: plain(a.name),
        family: "automation",
        automation: a,
        what: meta?.what ?? `A text the team set up in the Builder (${plain(a.name)}).`,
        who: meta?.who ?? trig?.who ?? "Customers this automation's trigger finds.",
        when: meta && !meta.wired ? "Nothing in the app sends this yet." : describeTiming(a.offsetsDays, anchor),
        anchor,
        before: Boolean(meta ? meta.before : trig?.before),
        after: Boolean(meta ? meta.after : trig?.after),
        marketing,
        emailFirst: a.channels.includes("email"),
        wired: meta ? meta.wired : Boolean(trig),
        on: a.armed,
        tokens: meta?.tokens ?? trig?.tokens ?? BASE,
        starter: toFriendly(override?.body ?? meta?.starter ?? ""),
        override,
        current: text && marketing ? withOptOutLine(text) : text,
      };
    });

  const builtIns = Object.entries(BUILT_IN).map(([key, b]): TextFlow => {
    const override = overrides[key];
    return {
      key,
      name: b.name,
      family: "built_in",
      what: b.what,
      who: b.who,
      when: b.when,
      before: false,
      after: false,
      marketing: false,
      emailFirst: false,
      wired: true,
      on: true,
      tokens: b.tokens,
      starter: toFriendly(override?.body ?? b.starter),
      override,
      current: override ? fill(override.body, ctx) : b.sample(),
    };
  });

  return [...builtIns, ...engine];
}

export async function textFlow(key: string): Promise<TextFlow | undefined> {
  return (await textFlows()).find((f) => f.key === key);
}

// --------------------------------------------------------------- overrides

export type Override = { body: string; by?: string; at: string };

const OVERRIDES = Symbol.for("hydrodam.smsOverrides");
const AUDIT = Symbol.for("hydrodam.automationAudit");
type Host = typeof globalThis & { [OVERRIDES]?: Record<string, Override>; [AUDIT]?: AuditEntry[] };
const host = () => globalThis as Host;
const memoryOverrides = () => (host()[OVERRIDES] ??= {});
const memoryAudit = () => (host()[AUDIT] ??= []);

const PREFIX = "automation_sms:";

export async function loadOverrides(): Promise<Record<string, Override>> {
  if (!SUPABASE_LIVE) return { ...memoryOverrides() };
  const rows = await pg.select<{ key: string; spec: { body?: string }; created_by: string | null; updated_at: string }>(
    "builder_items",
    { select: "key,spec,created_by,updated_at", kind: "eq.template", key: `like.${PREFIX}*`, status: "eq.live", limit: "100" }
  );
  return Object.fromEntries(
    rows.filter((r) => r.spec?.body).map((r) => [r.key.slice(PREFIX.length), { body: r.spec.body!, by: r.created_by ?? undefined, at: r.updated_at }])
  );
}

/**
 * The wording a flow should send right now: the office's own if they saved
 * one, otherwise whatever the built-in produced. A lookup failure falls back
 * to the built-in, because a missing override must never stop a text.
 */
export async function smsFor(key: string, ctx: TemplateContext, builtIn: string, marketing = false): Promise<string> {
  let body: string | undefined;
  try {
    body = (await loadOverrides())[key]?.body;
  } catch {
    body = undefined;
  }
  const text = body ? fill(body, ctx) : builtIn;
  return marketing && text ? withOptOutLine(text) : text;
}

export async function saveOverride(key: string, name: string, rawBody: string, by: string | undefined): Promise<void> {
  if (!SUPABASE_LIVE) {
    memoryOverrides()[key] = { body: rawBody, by, at: new Date().toISOString() };
    return;
  }
  await pg.insert(
    "builder_items",
    {
      company_id: await pg.rpc<string>("company_id", {}),
      kind: "template",
      key: `${PREFIX}${key}`,
      name: `Automation text: ${name}`,
      spec: { channel: "sms", body: rawBody },
      status: "live",
      created_by: by ?? null,
    },
    { onConflict: "company_id,kind,key" }
  );
}

export async function clearOverride(key: string): Promise<void> {
  if (!SUPABASE_LIVE) {
    delete memoryOverrides()[key];
    return;
  }
  await pg.patch("builder_items", { kind: "eq.template", key: `eq.${PREFIX}${key}` }, { status: "archived" });
}

export async function saveTiming(key: string, offsets: number[]): Promise<void> {
  if (!SUPABASE_LIVE) {
    const a = db().automations.find((x) => x.key === key);
    if (a) a.offsetsDays = offsets;
    return;
  }
  await pg.patch("automation_config", { automation_id: `eq.${key}` }, { offsets_days: offsets });
  invalidate();
}

// ------------------------------------------------------------------- audit

export type AuditEntry = { at: string; by: string; summary: string; changes: Record<string, unknown> };

/** activity_log wants a uuid entity id; a flow is known by its key, so derive a stable one. */
function entityId(key: string): string {
  const h = createHash("sha1").update(`text_automation:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function logChange(key: string, by: string | undefined, summary: string, changes: Record<string, unknown>): Promise<void> {
  const entry = { at: new Date().toISOString(), by: by ?? "Office", summary, changes };
  if (!SUPABASE_LIVE) {
    memoryAudit().unshift({ ...entry, changes: { ...changes, key } });
    return;
  }
  try {
    await pg.insert("activity_log", {
      company_id: await pg.rpc<string>("company_id", {}),
      actor_type: "user",
      actor_label: entry.by,
      verb: "automation.changed",
      entity_type: "text_automation",
      entity_id: entityId(key),
      summary,
      changes: { ...changes, key },
    });
  } catch {
    // The change itself is saved; losing its history line must not undo it.
  }
}

export async function history(key: string, limit = 20): Promise<AuditEntry[]> {
  if (!SUPABASE_LIVE) return memoryAudit().filter((e) => e.changes.key === key).slice(0, limit);
  const rows = await pg.select<{ occurred_at: string; actor_label: string | null; summary: string; changes: Record<string, unknown> }>(
    "activity_log",
    {
      select: "occurred_at,actor_label,summary,changes",
      entity_type: "eq.text_automation",
      entity_id: `eq.${entityId(key)}`,
      order: "occurred_at.desc",
      limit: String(limit),
    }
  );
  return rows.map((r) => ({ at: r.occurred_at, by: r.actor_label ?? "Office", summary: r.summary, changes: r.changes }));
}
