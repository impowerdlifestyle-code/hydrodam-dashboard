import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { db, existingClientId, getClient, smsGate } from "@/lib/db";
import { addDaysKey, dateTime, dayKey, money, todayKey } from "@/lib/format";
import { phoneKey } from "@/lib/telnyx";
import type { Client, Conversation, Job, Message, Quote, ServiceRequest, Visit } from "@/lib/types";

/**
 * The Texts copilot: pick a kind of message, Claude drafts it, a person edits,
 * sends or rejects it, and every decision is kept. The last eight decisions go
 * back into the next prompt as examples, so drafts drift toward how the office
 * actually writes rather than how a model thinks a contractor sounds.
 *
 * Nothing here sends. The send goes through `textClient` in lib/comms.ts, the
 * same gated path the booking and intake texts use.
 */

export const PROMPT_VERSION = "2026-09-23.v1";
export const DRAFT_MODEL = "claude-haiku-4-5-20251001";

export const SMS_KINDS = [
  {
    id: "assessment_reminder",
    label: "Assessment reminder",
    marketing: false,
    brief: "Remind them about their upcoming free on-site flood assessment. Use the date and time from the record exactly; if the record has no scheduled time, do not state one.",
  },
  {
    id: "assessment_booking_nudge",
    label: "Book the assessment",
    marketing: false,
    brief: "They asked about flood barriers but no assessment is booked. Invite them to pick a time for the free on-site assessment and say Emma can set it up. Do not propose specific times.",
  },
  {
    id: "quote_followup",
    label: "Quote follow-up",
    marketing: false,
    brief: "Follow up on the quote we sent. Mention the quote number if it is in the record. Offer to answer questions or walk through options. No pressure, no discounts.",
  },
  {
    id: "install_scheduling",
    label: "Schedule the install",
    marketing: false,
    brief: "The job is approved and the install needs a date. Ask which days work for them. Do not suggest a date unless one is in the record.",
  },
  {
    id: "install_reminder",
    label: "Install reminder",
    marketing: false,
    brief: "Remind them about the scheduled install. Use the date and time from the record exactly. If access notes exist, you may ask them to keep that access clear.",
  },
  {
    id: "post_install_checkin",
    label: "Post-install check-in",
    marketing: false,
    brief: "The barriers were installed recently. Check that everything is working and ask if they want a refresher on putting them up and storing them.",
  },
  {
    id: "review_request",
    label: "Review request",
    marketing: true,
    brief: "Thank them for choosing HydroDam and ask for a quick Google review, with the review link from the record.",
  },
  {
    id: "reply_to_latest",
    label: "Reply to their last text",
    marketing: false,
    brief: "Answer their most recent inbound text. Only state facts that are in the record. If they ask something the record does not answer (lead times, a price, a date), say Emma will check and get back to them.",
  },
  {
    id: "custom",
    label: "Custom",
    marketing: false,
    brief: "Follow the office's instruction below.",
  },
] as const;

export type SmsKind = (typeof SMS_KINDS)[number]["id"];
export type DraftAction = "pending" | "sent_as_is" | "sent_edited" | "rejected";

export const kindOf = (id: string) => SMS_KINDS.find((k) => k.id === id);

export type SmsDraft = {
  id: string;
  clientId: string;
  kind: SmsKind;
  promptVersion: string;
  model?: string;
  instruction?: string;
  draftText: string;
  finalText?: string;
  action: DraftAction;
  rejectReason?: string;
  messageId?: string;
  createdBy?: string;
  createdAt: string;
  decidedAt?: string;
};

// ------------------------------------------------------------------ roster

export type ConsentState = "stop" | "marketing" | "transactional" | "none";
export type Need = { kind: SmsKind; reason: string };
export type RosterRow = {
  client: Client;
  stage: string;
  stageStatus?: string;
  consent: ConsentState;
  last?: Message;
  needs: Need[];
};

export function consentState(c: Client): ConsentState {
  if (c.smsOptOutAt) return "stop";
  if (c.smsMarketingConsent) return "marketing";
  if (c.smsConsent) return "transactional";
  return "none";
}

const DAY = 86_400_000;
const newest = <T>(rows: T[], at: (r: T) => string | undefined): T | undefined =>
  [...rows].sort((a, b) => (at(b) ?? "").localeCompare(at(a) ?? ""))[0];

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

type Index = {
  quotes: Map<string, Quote[]>;
  jobs: Map<string, Job[]>;
  visits: Map<string, Visit[]>;
  requests: Map<string, ServiceRequest[]>;
  smsByPhone: Map<string, Conversation>;
  messages: Map<string, Message[]>;
};

function buildIndex(): Index {
  const d = db();
  return {
    quotes: group(d.quotes, (q) => q.clientId),
    jobs: group(d.jobs, (j) => j.clientId),
    visits: group(d.visits, (v) => v.clientId),
    requests: group(d.requests, (r) => r.clientId),
    smsByPhone: new Map(d.conversations.filter((c) => c.channel === "sms").map((c) => [phoneKey(c.externalAddress), c])),
    messages: group(
      [...d.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      (m) => m.conversationId
    ),
  };
}

function stageOf(client: Client, idx: Index): { label: string; status?: string } {
  const job = newest(idx.jobs.get(client.id) ?? [], (j) => j.createdAt);
  if (job) return { label: "Job", status: job.status };
  const quote = newest(idx.quotes.get(client.id) ?? [], (q) => q.createdAt);
  if (quote) return { label: "Quote", status: quote.status };
  const req = newest(idx.requests.get(client.id) ?? [], (r) => r.createdAt);
  if (req) return { label: "Request", status: req.status };
  return { label: client.crmStatusLabel ? `Lead · ${client.crmStatusLabel}` : "Lead", status: client.crmStatus };
}

function needsOf(client: Client, idx: Index, thread: Message[]): Need[] {
  const needs: Need[] = [];
  const now = Date.now();
  const tomorrow = addDaysKey(todayKey(), 1);
  const last = thread.at(-1);
  const lastInboundAt = newest(thread.filter((m) => m.direction === "inbound"), (m) => m.createdAt)?.createdAt ?? "";
  const lastOutboundAt = newest(thread.filter((m) => m.direction === "outbound"), (m) => m.createdAt)?.createdAt ?? "";

  if (last?.direction === "inbound") needs.push({ kind: "reply_to_latest", reason: "Unanswered text" });

  const visits = idx.visits.get(client.id) ?? [];
  const live = (v: Visit) => v.status === "scheduled" || v.status === "confirmed";
  if (visits.some((v) => v.kind === "assessment" && live(v) && dayKey(v.scheduledStart) === tomorrow)) {
    needs.push({ kind: "assessment_reminder", reason: "Assessment tomorrow" });
  }
  if (visits.some((v) => v.kind === "install" && live(v) && dayKey(v.scheduledStart) === tomorrow)) {
    needs.push({ kind: "install_reminder", reason: "Install tomorrow" });
  }

  for (const q of idx.quotes.get(client.id) ?? []) {
    if (!["sent", "viewed"].includes(q.status) || !q.sentAt) continue;
    const days = Math.floor((now - Date.parse(q.sentAt)) / DAY);
    const quiet = lastInboundAt < q.sentAt && (!lastOutboundAt || now - Date.parse(lastOutboundAt) > 3 * DAY);
    if (days > 3 && quiet) {
      needs.push({ kind: "quote_followup", reason: `Quote #${q.number} sent ${days}d ago, no reply` });
      break;
    }
  }

  const jobs = idx.jobs.get(client.id) ?? [];
  if (jobs.some((j) => j.status === "pending") && !visits.some((v) => v.kind === "install" && v.status !== "cancelled")) {
    needs.push({ kind: "install_scheduling", reason: "Install not scheduled" });
  }

  const installedAt = newest(
    [
      ...jobs.map((j) => j.completedAt),
      ...visits.filter((v) => v.kind === "install" && v.status === "completed").map((v) => v.completedAt),
    ].filter((x): x is string => Boolean(x)),
    (x) => x
  );
  if (installedAt && now - Date.parse(installedAt) < 14 * DAY && lastOutboundAt < installedAt) {
    needs.push({ kind: "post_install_checkin", reason: `Installed ${Math.floor((now - Date.parse(installedAt)) / DAY)}d ago` });
  }

  const openRequest = (idx.requests.get(client.id) ?? []).find(
    (r) => ["new", "contacted"].includes(r.status) && now - Date.parse(r.createdAt) > 2 * DAY && now - Date.parse(r.createdAt) < 30 * DAY
  );
  if (openRequest && !visits.some((v) => v.kind === "assessment") && !(idx.quotes.get(client.id) ?? []).length) {
    needs.push({ kind: "assessment_booking_nudge", reason: "No assessment booked" });
  }

  return needs;
}

/** Everyone with a mobile number, with the facts the Texts list shows and filters on. */
export function textRoster(): RosterRow[] {
  const idx = buildIndex();
  return db()
    .clients.filter((c) => phoneKey(c.phone).length === 10)
    .map((client) => {
      const conv = idx.smsByPhone.get(phoneKey(client.phone));
      const thread = conv ? idx.messages.get(conv.id) ?? [] : [];
      const stage = stageOf(client, idx);
      return {
        client,
        stage: stage.label,
        stageStatus: stage.status,
        consent: consentState(client),
        last: thread.at(-1),
        needs: needsOf(client, idx, thread),
      };
    });
}

const BY_STAGE: Record<string, SmsKind> = {
  new: "assessment_booking_nudge",
  contacted: "assessment_booking_nudge",
  assessment_scheduled: "assessment_reminder",
  sent: "quote_followup",
  viewed: "quote_followup",
  approved: "install_scheduling",
  pending: "install_scheduling",
  scheduled: "install_reminder",
  completed: "post_install_checkin",
  invoiced: "post_install_checkin",
  closed: "review_request",
};

/** What the copilot should offer first: the most pressing need, else what the stage implies. */
export function suggestedKind(client: Client, thread: Message[]): SmsKind {
  const idx = buildIndex();
  const need = needsOf(client, idx, thread)[0];
  if (need) return need.kind;
  const status = stageOf(client, idx).status;
  return (status && BY_STAGE[status]) || (thread.some((m) => m.direction === "inbound") ? "reply_to_latest" : "custom");
}

/** Why each kind cannot be sent to this client right now, or undefined when it can. */
export function kindGates(client: Client): Record<SmsKind, string | undefined> {
  const out = {} as Record<SmsKind, string | undefined>;
  for (const k of SMS_KINDS) out[k.id] = smsGate(client, k.marketing ? "marketing" : "transactional").reason;
  return out;
}

// ----------------------------------------------------------------- storage
//
// Postgres when configured (0006_sms_copilot.sql); otherwise an in-process
// list on globalThis, for the same reason the snapshot lives there: route
// handlers and pages are separate module instances in dev.

const MEMORY = Symbol.for("hydrodam.smsDrafts");
type Host = typeof globalThis & { [MEMORY]?: SmsDraft[] };
const memory = (): SmsDraft[] => {
  const h = globalThis as Host;
  if (!h[MEMORY]) h[MEMORY] = [];
  return h[MEMORY];
};

type DraftRow = {
  id: string;
  client_id: string;
  kind: SmsKind;
  prompt_version: string;
  model: string | null;
  instruction: string | null;
  draft_text: string;
  final_text: string | null;
  action: DraftAction;
  reject_reason: string | null;
  message_id: string | null;
  created_by: string | null;
  created_at: string;
  decided_at: string | null;
};

const COLS =
  "id,client_id,kind,prompt_version,model,instruction,draft_text,final_text,action,reject_reason,message_id,created_by,created_at,decided_at";

const fromRow = (r: DraftRow): SmsDraft => ({
  id: r.id,
  clientId: r.client_id,
  kind: r.kind,
  promptVersion: r.prompt_version,
  model: r.model ?? undefined,
  instruction: r.instruction ?? undefined,
  draftText: r.draft_text,
  finalText: r.final_text ?? undefined,
  action: r.action,
  rejectReason: r.reject_reason ?? undefined,
  messageId: r.message_id ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  decidedAt: r.decided_at ?? undefined,
});

const DECIDED = ["sent_as_is", "sent_edited", "rejected"] as const;

/**
 * The client id a draft is filed under. In live mode that must be a Postgres
 * row; a HubSpot-only lead has none, and has no consent either, so there is
 * nothing to send and nothing worth promoting them for.
 */
export function draftClientId(clientId: string): string | undefined {
  return SUPABASE_LIVE ? existingClientId(clientId) : getClient(clientId)?.id;
}

export async function draftsFor(clientId: string, limit = 6): Promise<SmsDraft[]> {
  const id = draftClientId(clientId);
  if (!id) return [];
  if (!SUPABASE_LIVE) {
    return memory().filter((d) => d.clientId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  const rows = await pg.select<DraftRow>("sms_drafts", {
    select: COLS, client_id: `eq.${id}`, order: "created_at.desc", limit: String(limit),
  });
  return rows.map(fromRow);
}

export async function getDraft(id: string): Promise<SmsDraft | undefined> {
  if (!SUPABASE_LIVE) return memory().find((d) => d.id === id);
  const [row] = await pg.select<DraftRow>("sms_drafts", { select: COLS, id: `eq.${id}`, limit: "1" });
  return row ? fromRow(row) : undefined;
}

/** Same kind first, topped up with the most recent of any kind. */
export async function trainingExamples(kind: SmsKind, limit = 8): Promise<SmsDraft[]> {
  if (!SUPABASE_LIVE) {
    const decided = memory()
      .filter((d) => (DECIDED as readonly string[]).includes(d.action))
      .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
    const same = decided.filter((d) => d.kind === kind);
    return [...same, ...decided.filter((d) => d.kind !== kind)].slice(0, limit);
  }
  const base = { select: COLS, action: `in.(${DECIDED.join(",")})`, order: "decided_at.desc.nullslast", limit: String(limit) };
  const [same, any] = await Promise.all([
    pg.select<DraftRow>("sms_drafts", { ...base, kind: `eq.${kind}` }),
    pg.select<DraftRow>("sms_drafts", base),
  ]);
  const seen = new Set(same.map((r) => r.id));
  return [...same, ...any.filter((r) => !seen.has(r.id))].slice(0, limit).map(fromRow);
}

export async function trainingCount(): Promise<number> {
  if (!SUPABASE_LIVE) return memory().filter((d) => (DECIDED as readonly string[]).includes(d.action)).length;
  const rows = await pg.select<{ id: string }>("sms_drafts", {
    select: "id", action: `in.(${DECIDED.join(",")})`, limit: "1000",
  });
  return rows.length;
}

async function insertDraft(d: Omit<SmsDraft, "id" | "createdAt" | "action">): Promise<SmsDraft> {
  if (!SUPABASE_LIVE) {
    const draft: SmsDraft = { ...d, id: `smsd_${memory().length + 1}`, action: "pending", createdAt: new Date().toISOString() };
    memory().push(draft);
    return draft;
  }
  const [row] = await pg.insert<DraftRow>("sms_drafts", {
    company_id: await pg.rpc<string>("company_id", {}),
    client_id: d.clientId,
    kind: d.kind,
    prompt_version: d.promptVersion,
    model: d.model ?? null,
    instruction: d.instruction ?? null,
    draft_text: d.draftText,
    created_by: d.createdBy ?? null,
  });
  return fromRow(row);
}

export async function decideDraft(
  id: string,
  decision: { action: Exclude<DraftAction, "pending">; finalText?: string; rejectReason?: string; messageId?: string }
): Promise<void> {
  const decidedAt = new Date().toISOString();
  if (!SUPABASE_LIVE) {
    const d = memory().find((x) => x.id === id);
    if (d) Object.assign(d, { ...decision, decidedAt });
    return;
  }
  await pg.patch("sms_drafts", { id: `eq.${id}`, action: "eq.pending" }, {
    action: decision.action,
    final_text: decision.finalText ?? null,
    reject_reason: decision.rejectReason ?? null,
    message_id: decision.messageId ?? null,
    decided_at: decidedAt,
  });
}

// ------------------------------------------------------------------ prompt

const SYSTEM = `You write text messages from the HydroDam office to one customer at a time. HydroDam is a woman-owned flood barrier company in Clearwater, Florida: removable aluminum barriers for doors, garages and sliders. Texts come from the office; Emma handles scheduling.

Voice:
- Short: one or two SMS segments, ideally under 300 characters. Warm, plain, specific, like a person at a small local business.
- Open with their first name. No emojis. No exclamation-mark pileups. No links unless the record gives one and the task needs it.
- Never use em dashes or en dashes. Use commas or full stops.
- Never write "genuinely", "truly", "means the world", "reach out", "circle back" or similar filler.
- Never call the product "FEMA-compliant", "FEMA-certified" or certified by anyone. Never promise or imply insurance savings or premium reductions.
- Never invent appointment dates or times, prices, quote numbers, lead times, crew names or any fact that is not in the record. If a price is needed and none is in the record, the only number you may use is HydroDam's published starting price, $1,850 installed.
- Do not add "Reply STOP to opt out" or any opt-out line; the send path adds it where the law requires it.
- Do not sign off with a long signature. Ending with "HydroDam" or "Emma, HydroDam" is fine when it reads naturally.

Past decisions from the office are included. Copy the style of messages they sent, and avoid what they rejected.

Reply with the text message only: no quotes, no preamble, no explanation.`;

const REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJz4jfpxGKmaER_CXaCbjDOgU";

function recordFor(client: Client, kind: SmsKind): string {
  const d = db();
  const prop = d.properties.find((p) => p.clientId === client.id);
  const lines: string[] = [];
  lines.push(`Name: ${client.name} (first name: ${client.name.split(" ")[0]})`);
  lines.push(`Type: ${client.type.replace(/_/g, " ")}`);
  if (prop) {
    lines.push(`Property: ${prop.address}, ${prop.city}${prop.floodZone ? `, flood zone ${prop.floodZone}` : ""}`);
    if (prop.accessNotes) lines.push(`Access notes: ${prop.accessNotes}`);
  }
  if (client.crmStatusLabel) lines.push(`CRM status: ${client.crmStatusLabel}`);

  for (const r of d.requests.filter((x) => x.clientId === client.id)) {
    lines.push(`Request #${r.number}: ${r.title}, status ${r.status}, came in ${dateTime(r.createdAt)} via ${r.source}`);
  }
  for (const q of d.quotes.filter((x) => x.clientId === client.id)) {
    lines.push(
      `Quote #${q.number}: ${q.title}, ${q.primarySeries} series, ${q.openings.length} opening(s), total ${money(q.totalCents)}, ` +
      `deposit ${money(q.depositDueCents)}, status ${q.status}` +
      `${q.sentAt ? `, sent ${dateTime(q.sentAt)}` : ""}${q.validUntil ? `, valid until ${q.validUntil}` : ""}`
    );
  }
  for (const j of d.jobs.filter((x) => x.clientId === client.id)) {
    lines.push(
      `Job #${j.number}: ${j.title}, status ${j.status}, fabrication ${j.fabricationStatus.replace(/_/g, " ")}` +
      `${j.completedAt ? `, completed ${dateTime(j.completedAt)}` : ""}`
    );
  }
  for (const v of d.visits.filter((x) => x.clientId === client.id && x.status !== "cancelled")) {
    const when = v.status === "unscheduled" ? "not yet scheduled" : `${dateTime(v.scheduledStart)} to ${dateTime(v.scheduledEnd)}`;
    lines.push(`Visit: ${v.kind.replace(/_/g, " ")} (${v.title}), ${v.status}, ${when}`);
  }
  if (kind === "review_request") lines.push(`Google review link: ${REVIEW_URL}`);
  lines.push(`Today: ${dateTime(new Date().toISOString())} (America/New_York)`);
  return lines.join("\n");
}

function examplesBlock(examples: SmsDraft[]): string {
  if (!examples.length) return "(none yet. Be conservative and plain.)";
  return examples
    .map((e, i) => {
      const tag =
        e.action === "rejected"
          ? `EXAMPLE ${i + 1}, REJECTED (avoid this)${e.rejectReason ? `. Reason: ${e.rejectReason}` : ""}`
          : e.action === "sent_edited"
            ? `EXAMPLE ${i + 1}, edited by the office then sent (write like the final version)`
            : `EXAMPLE ${i + 1}, sent as drafted`;
      const body =
        e.action === "sent_edited" && e.finalText
          ? `Draft: ${e.draftText}\nFinal: ${e.finalText}`
          : e.draftText;
      return `${tag}\nKind: ${e.kind}\n${body}`;
    })
    .join("\n\n");
}

/** Dashes, emoji and any opt-out line the model added anyway, removed without asking it twice. */
export function cleanDraft(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s*Reply STOP to opt out\.?\s*$/i, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const BANNED: [RegExp, string][] = [
  [/\bgenuinely\b|\btruly\b|means the world/i, "filler the office asked to avoid"],
  [/FEMA[- ]?(compliant|certified|approved)/i, "a FEMA claim"],
  [/insurance|premium/i, "an insurance mention; check it promises nothing"],
];

export function voiceWarnings(text: string): string[] {
  return BANNED.filter(([re]) => re.test(text)).map(([, why]) => why);
}

export class DraftingUnavailable extends Error {}

export async function draftText(opts: {
  client: Client;
  kind: SmsKind;
  thread: Message[];
  instruction?: string;
  createdBy?: string;
}): Promise<SmsDraft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new DraftingUnavailable("Drafting is not configured: ANTHROPIC_API_KEY is not set on this deployment.");
  const clientId = draftClientId(opts.client.id);
  if (!clientId) {
    throw new DraftingUnavailable(
      "This lead only exists in HubSpot. Record their SMS consent on the client page first, which adds them to the database."
    );
  }

  const kind = kindOf(opts.kind)!;
  const examples = await trainingExamples(opts.kind);
  const history = opts.thread.slice(-10);
  const historyBlock = history.length
    ? history.map((m) => `[${m.direction === "inbound" ? "THEM" : "US"} ${dateTime(m.createdAt)}] ${m.body}`).join("\n")
    : "(no texts yet)";

  const prompt = `CUSTOMER RECORD
${recordFor(opts.client, opts.kind)}

LAST TEXTS ON THIS THREAD (oldest first)
${historyBlock}

PAST DECISIONS BY THE OFFICE (most recent first)
${examplesBlock(examples)}

TASK: write a "${kind.label}" text (${kind.id}).
${kind.brief}${opts.instruction ? `\n\nInstruction from the office: ${opts.instruction}` : ""}`;

  const anthropic = new Anthropic({ apiKey: key });
  const res = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const text = cleanDraft(res.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  if (!text) throw new Error("The model returned an empty draft. Try again.");

  return insertDraft({
    clientId,
    kind: opts.kind,
    promptVersion: PROMPT_VERSION,
    model: DRAFT_MODEL,
    instruction: opts.instruction,
    draftText: text,
    createdBy: opts.createdBy,
  });
}
