import "server-only";
import { buildSeed } from "@/lib/seed";
import { CRM_LIVE, fetchCrm } from "@/lib/hubspot";
import { phoneDisplay } from "@/lib/format";
import { phoneKey, toE164 } from "@/lib/telnyx";
import type {
  Client, Conversation, Invoice, Job, Message, Opening, Payment, Property, Quote,
  ServiceRequest, Snapshot, Staff, Visit,
} from "@/lib/types";

/**
 * Data access.
 *
 * Postgres (Supabase) is the intended system of record — the schema lives in
 * supabase/migrations/0001_init.sql. Until SUPABASE_URL is set, the app runs on
 * the seeded snapshot in lib/seed.ts so every screen is real and clickable.
 *
 * Mutations write to the in-process snapshot. That survives navigation on a warm
 * server but not a cold start, which is exactly the limitation the migration
 * removes. Nothing else in the app knows the difference.
 */

export const DB_LIVE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// The snapshot hangs off globalThis rather than a module binding because Next
// bundles route handlers and page renders separately — two module instances,
// two snapshots. Without this, an SMS written by the Telnyx webhook would be
// invisible to the Inbox that renders it.
const SNAPSHOT = Symbol.for("hydrodam.snapshot");
type SnapshotHost = typeof globalThis & { [SNAPSHOT]?: Snapshot };

export function db(): Snapshot {
  const host = globalThis as SnapshotHost;
  if (!host[SNAPSHOT]) {
    const seeded = buildSeed();
    for (const c of seeded.clients) c.demo = true;
    for (const r of seeded.requests) r.demo = true;
    host[SNAPSHOT] = seeded;
  }
  return host[SNAPSHOT];
}

// ---------------------------------------------------------------------- CRM
//
// HubSpot backs the people half of the app: Clients and Requests. Everything
// downstream of a measurement — jobs, visits, invoices, materials — has no
// source system yet and stays on the seeded demo rows until Supabase exists.
//
// Contacts are merged into the same snapshot the seed lives in, so every
// existing lookup keeps working. Seeded people carry `demo: true` and are
// filtered out of the two live screens; they remain so seeded jobs and invoices
// can still resolve a client name.

let crmLoadedAt = 0;
let crmMeta: { contactCount: number; addressedCount: number; fetchedAt: string } | null = null;
let inFlight: Promise<void> | null = null;

const CRM_TTL_MS = 10 * 60_000;

export const crmStatus = () => ({ live: CRM_LIVE && crmMeta !== null, ...crmMeta });

/**
 * Hydrates the snapshot from HubSpot. Safe to call on every render — it fetches
 * at most once per TTL per server instance, and concurrent callers share the
 * one in-flight request rather than each starting their own.
 */
export async function ensureCrm(): Promise<void> {
  if (!CRM_LIVE) return;
  if (crmMeta && Date.now() - crmLoadedAt < CRM_TTL_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const crm = await fetchCrm();
      if (!crm) return;
      const d = db();
      // SMS_LEAD_SOURCE rows were created by someone texting the Telnyx number.
      // They have no HubSpot record yet, so a refresh must not wipe them.
      d.clients = [...d.clients.filter((c) => c.demo || c.leadSource === SMS_LEAD_SOURCE), ...crm.clients];
      d.properties = [...d.properties.filter((p) => !p.id.startsWith("hsp_")), ...crm.properties];
      d.requests = [...d.requests.filter((r) => r.demo), ...crm.requests];
      crmMeta = {
        contactCount: crm.contactCount,
        addressedCount: crm.addressedCount,
        fetchedAt: crm.fetchedAt,
      };
      crmLoadedAt = Date.now();
    } catch {
      // A CRM outage must never take the dashboard down. Seed stays visible.
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Clients and Requests as the two live screens should see them. */
export const liveClients = (): Client[] => (crmMeta ? db().clients.filter((c) => !c.demo) : db().clients);
export const liveRequests = (): ServiceRequest[] => (crmMeta ? db().requests.filter((r) => !r.demo) : db().requests);

// ------------------------------------------------------------------ lookups

export const getClient = (id: string): Client | undefined => db().clients.find((c) => c.id === id);
export const getProperty = (id: string): Property | undefined => db().properties.find((p) => p.id === id);
export const getQuote = (id: string): Quote | undefined => db().quotes.find((q) => q.id === id);
export const getJob = (id: string): Job | undefined => db().jobs.find((j) => j.id === id);
export const getInvoice = (id: string): Invoice | undefined => db().invoices.find((i) => i.id === id);
export const getVisit = (id: string): Visit | undefined => db().visits.find((v) => v.id === id);
export const getRequest = (id: string): ServiceRequest | undefined => db().requests.find((r) => r.id === id);
export const getStaff = (id: string): Staff | undefined => db().staff.find((s) => s.id === id);
export const getConversation = (id: string): Conversation | undefined => db().conversations.find((c) => c.id === id);

export const clientName = (id: string): string => getClient(id)?.name ?? "Unknown client";
export const staffName = (id: string): string => getStaff(id)?.name ?? "Unassigned";

export function propertyFor(clientId: string): Property | undefined {
  return db().properties.find((p) => p.clientId === clientId);
}

export function openingsFor(propertyId: string): Opening[] {
  return db().openings.filter((o) => o.propertyId === propertyId);
}

export function quotesFor(clientId: string): Quote[] {
  return db().quotes.filter((q) => q.clientId === clientId);
}

export function jobsFor(clientId: string): Job[] {
  return db().jobs.filter((j) => j.clientId === clientId);
}

export function invoicesFor(clientId: string): Invoice[] {
  return db().invoices.filter((i) => i.clientId === clientId);
}

export function visitsForJob(jobId: string): Visit[] {
  return db().visits.filter((v) => v.jobId === jobId).sort((a, b) => a.sequence - b.sequence);
}

export function messagesFor(conversationId: string): Message[] {
  return db()
    .messages.filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function paymentsFor(invoiceId: string): Payment[] {
  return db().payments.filter((p) => p.invoiceId === invoiceId);
}

// ------------------------------------------------------------------ schedule

export function visitsBetween(startISO: string, endISO: string): Visit[] {
  return db()
    .visits.filter((v) => v.scheduledStart >= startISO && v.scheduledStart < endISO)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

export function visitsOn(date: Date): Visit[] {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  return visitsBetween(start.toISOString(), end.toISOString());
}

export function todaysVisits(): Visit[] {
  return visitsOn(new Date());
}

export function unscheduledVisits(): Visit[] {
  return db().visits.filter((v) => v.status === "unscheduled" || v.assignedTo.length === 0);
}

export function visitsForStaff(userId: string, date: Date): Visit[] {
  return visitsOn(date).filter((v) => v.assignedTo.includes(userId));
}

// ------------------------------------------------------------------ costing

export type JobCosting = {
  revenueCents: number;
  invoicedCents: number;
  collectedCents: number;
  laborCents: number;
  laborMinutes: number;
  materialCents: number;
  grossProfitCents: number;
  marginBps: number;
};

export function jobCosting(jobId: string): JobCosting {
  const d = db();
  const job = d.jobs.find((j) => j.id === jobId);
  const revenue = job?.contractCents ?? 0;
  const jobInvoices = d.invoices.filter((i) => i.jobId === jobId && i.status !== "void");
  const invoiced = jobInvoices.reduce((s, i) => s + i.totalCents, 0);
  const collected = jobInvoices.reduce((s, i) => s + i.amountPaidCents, 0);

  let laborMinutes = 0;
  let laborCents = 0;
  for (const t of d.timeEntries) {
    if (t.jobId !== jobId || !t.endedAt) continue;
    const mins = Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 - t.breakMinutes);
    laborMinutes += mins;
    laborCents += Math.round((mins / 60) * t.costRateCentsPerHour);
  }

  const materialCents = d.materials
    .filter((m) => m.jobId === jobId)
    .reduce((s, m) => s + Math.round(m.quantity * m.unitCostCents), 0);

  const grossProfitCents = revenue - laborCents - materialCents;
  return {
    revenueCents: revenue,
    invoicedCents: invoiced,
    collectedCents: collected,
    laborCents,
    laborMinutes,
    materialCents,
    grossProfitCents,
    marginBps: revenue > 0 ? Math.round((grossProfitCents / revenue) * 10_000) : 0,
  };
}

// ------------------------------------------------------------------ metrics

export type Metrics = {
  openPipelineCents: number;
  openQuoteCount: number;
  wonThisMonthCents: number;
  collectedThisMonthCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  unassignedRequests: number;
  visitsToday: number;
  unreadMessages: number;
  closeRatePct: number;
  avgTicketCents: number;
  activeJobs: number;
  slowResponses: number;
};

export function metrics(): Metrics {
  const d = db();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const openQuotes = d.quotes.filter((q) => q.status === "sent" || q.status === "viewed" || q.status === "draft");
  const decided = d.quotes.filter((q) => ["approved", "converted", "declined", "expired"].includes(q.status));
  const won = decided.filter((q) => q.status === "approved" || q.status === "converted");

  const outstanding = d.invoices.filter((i) => ["sent", "viewed", "partially_paid"].includes(i.status));
  const overdue = outstanding.filter((i) => (i.dueDate ?? "9999") < today);

  const slowResponses = d.requests.filter((r) => {
    if (!r.firstResponseAt) return r.status === "new";
    return Date.parse(r.firstResponseAt) - Date.parse(r.createdAt) > 5 * 60_000;
  }).length;

  return {
    openPipelineCents: openQuotes.reduce((s, q) => s + q.totalCents, 0),
    openQuoteCount: openQuotes.length,
    wonThisMonthCents: won.filter((q) => (q.approvedAt ?? "") >= monthStart).reduce((s, q) => s + q.totalCents, 0),
    collectedThisMonthCents: d.payments
      .filter((p) => p.status === "succeeded" && p.receivedOn >= monthStart.slice(0, 10))
      .reduce((s, p) => s + p.amountCents, 0),
    outstandingCents: outstanding.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0),
    overdueCents: overdue.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0),
    overdueCount: overdue.length,
    unassignedRequests: d.requests.filter((r) => r.status === "new").length,
    visitsToday: todaysVisits().length,
    unreadMessages: d.conversations.reduce((s, c) => s + c.unreadCount, 0),
    closeRatePct: decided.length ? Math.round((won.length / decided.length) * 100) : 0,
    avgTicketCents: won.length ? Math.round(won.reduce((s, q) => s + q.totalCents, 0) / won.length) : 0,
    activeJobs: d.jobs.filter((j) => ["pending", "scheduled", "in_progress", "on_hold"].includes(j.status)).length,
    slowResponses,
  };
}

export function revenueByMonth(months = 6): { month: string; bookedCents: number; collectedCents: number }[] {
  const d = db();
  const out: { month: string; bookedCents: number; collectedCents: number }[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const s = start.toISOString();
    const e = end.toISOString();
    out.push({
      month: start.toLocaleDateString("en-US", { month: "short" }),
      bookedCents: d.quotes
        .filter((q) => (q.approvedAt ?? "") >= s && (q.approvedAt ?? "") < e)
        .reduce((sum, q) => sum + q.totalCents, 0),
      collectedCents: d.payments
        .filter((p) => p.receivedOn >= s.slice(0, 10) && p.receivedOn < e.slice(0, 10))
        .reduce((sum, p) => sum + p.amountCents, 0),
    });
  }
  return out;
}

export function arAging(): { bucket: string; cents: number; count: number }[] {
  const d = db();
  const today = Date.now();
  const buckets = [
    { bucket: "Current", min: -Infinity, max: 0 },
    { bucket: "1–30", min: 0, max: 30 },
    { bucket: "31–60", min: 30, max: 60 },
    { bucket: "61–90", min: 60, max: 90 },
    { bucket: "90+", min: 90, max: Infinity },
  ];
  return buckets.map((b) => {
    const rows = d.invoices.filter((i) => {
      if (!["sent", "viewed", "partially_paid"].includes(i.status)) return false;
      const days = (today - Date.parse(i.dueDate ?? "")) / 86_400_000;
      return days > b.min && days <= b.max;
    });
    return {
      bucket: b.bucket,
      cents: rows.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0),
      count: rows.length,
    };
  });
}

export function sourcePerformance(): { source: string; leads: number; wonCents: number }[] {
  const d = db();
  const map = new Map<string, { leads: number; wonCents: number }>();
  for (const c of d.clients) {
    const row = map.get(c.leadSource) ?? { leads: 0, wonCents: 0 };
    row.leads += 1;
    row.wonCents += d.quotes
      .filter((q) => q.clientId === c.id && (q.status === "approved" || q.status === "converted"))
      .reduce((s, q) => s + q.totalCents, 0);
    map.set(c.leadSource, row);
  }
  return [...map.entries()]
    .map(([source, v]) => ({ source, ...v }))
    .sort((a, b) => b.wonCents - a.wonCents);
}

export function crewUtilization(): { staffId: string; name: string; minutes: number; costCents: number }[] {
  const d = db();
  return d.staff
    .filter((s) => s.role === "crew")
    .map((s) => {
      let minutes = 0;
      let costCents = 0;
      for (const t of d.timeEntries) {
        if (t.userId !== s.id || !t.endedAt) continue;
        const m = Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 - t.breakMinutes);
        minutes += m;
        costCents += Math.round((m / 60) * t.costRateCentsPerHour);
      }
      return { staffId: s.id, name: s.name, minutes, costCents };
    });
}

// ------------------------------------------------------------------ mutations

export function updateVisit(id: string, patch: Partial<Visit>): Visit | undefined {
  const v = db().visits.find((x) => x.id === id);
  if (v) Object.assign(v, patch);
  return v;
}

export function moveVisit(id: string, startISO: string, staffId?: string): Visit | undefined {
  const v = db().visits.find((x) => x.id === id);
  if (!v) return undefined;
  const durationMs = Date.parse(v.scheduledEnd) - Date.parse(v.scheduledStart);
  v.scheduledStart = startISO;
  v.scheduledEnd = new Date(Date.parse(startISO) + durationMs).toISOString();
  if (staffId) v.assignedTo = [staffId];
  if (v.status === "unscheduled") v.status = "scheduled";
  return v;
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const j = db().jobs.find((x) => x.id === id);
  if (j) Object.assign(j, patch);
  return j;
}

export function updateQuote(id: string, patch: Partial<Quote>): Quote | undefined {
  const q = db().quotes.find((x) => x.id === id);
  if (q) Object.assign(q, patch);
  return q;
}

export function updateRequest(id: string, patch: Partial<ServiceRequest>): ServiceRequest | undefined {
  const r = db().requests.find((x) => x.id === id);
  if (r) Object.assign(r, patch);
  return r;
}

export function updateInvoice(id: string, patch: Partial<Invoice>): Invoice | undefined {
  const i = db().invoices.find((x) => x.id === id);
  if (i) Object.assign(i, patch);
  return i;
}

export function recordPayment(invoiceId: string, amountCents: number, method: Payment["method"]): Payment | undefined {
  const d = db();
  const inv = d.invoices.find((i) => i.id === invoiceId);
  if (!inv) return undefined;
  const payment: Payment = {
    id: `pay_${d.payments.length + 1}`,
    invoiceId,
    clientId: inv.clientId,
    method,
    status: method === "ach" ? "processing" : "succeeded",
    amountCents,
    feeCents: method === "ach" ? 500 : method === "card" ? Math.round(amountCents * 0.029) + 30 : 0,
    receivedOn: new Date().toISOString().slice(0, 10),
    expectedSettlementOn:
      method === "ach" ? new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10) : undefined,
  };
  d.payments.push(payment);
  if (payment.status === "succeeded") {
    inv.amountPaidCents = Math.min(inv.totalCents, inv.amountPaidCents + amountCents);
    if (inv.amountPaidCents >= inv.totalCents) {
      inv.status = "paid";
      inv.paidAt = new Date().toISOString();
    } else if (inv.amountPaidCents > 0) {
      inv.status = "partially_paid";
    }
  }
  return payment;
}

export function sendMessage(
  conversationId: string,
  body: string,
  meta?: { providerId?: string; deliveryStatus?: Message["deliveryStatus"]; templateKey?: string }
): Message | undefined {
  const d = db();
  const conv = d.conversations.find((c) => c.id === conversationId);
  if (!conv) return undefined;
  const msg: Message = {
    id: `ms_${d.messages.length + 1}`,
    conversationId,
    clientId: conv.clientId,
    channel: conv.channel,
    direction: "outbound",
    body,
    createdAt: new Date().toISOString(),
    read: true,
    ...meta,
  };
  d.messages.push(msg);
  conv.lastMessageAt = msg.createdAt;
  conv.status = "open";
  return msg;
}

export function markConversationRead(conversationId: string): void {
  const conv = db().conversations.find((c) => c.id === conversationId);
  if (conv) conv.unreadCount = 0;
  for (const m of db().messages) if (m.conversationId === conversationId) m.read = true;
}

export function saveChecklist(jobId: string, visitId: string, answers: Record<string, string>, submit: boolean, by: string) {
  const d = db();
  const job = d.jobs.find((j) => j.id === jobId);
  if (!job) return undefined;
  let sub = d.submissions.find((s) => s.visitId === visitId && s.templateKey === "qa_checklist");
  if (!sub) {
    sub = {
      id: `fs_${d.submissions.length + 1}`,
      templateKey: "qa_checklist",
      jobId,
      visitId,
      clientId: job.clientId,
      status: "draft",
      answers: {},
    };
    d.submissions.push(sub);
  }
  sub.answers = { ...sub.answers, ...answers };
  if (submit) {
    sub.status = "submitted";
    sub.submittedAt = new Date().toISOString();
    sub.submittedByName = by;
  }
  return sub;
}

export function checklistFor(visitId: string) {
  return db().submissions.find((s) => s.visitId === visitId && s.templateKey === "qa_checklist");
}

export function clockIn(userId: string, jobId?: string, visitId?: string) {
  const d = db();
  const staffRow = d.staff.find((s) => s.id === userId);
  const entry = {
    id: `t_${d.timeEntries.length + 1}`,
    userId,
    jobId,
    visitId,
    startedAt: new Date().toISOString(),
    breakMinutes: 0,
    activity: "install" as const,
    costRateCentsPerHour: staffRow?.costRateCentsPerHour ?? 0,
  };
  d.timeEntries.push(entry);
  return entry;
}

export function clockOut(userId: string) {
  const open = db().timeEntries.filter((t) => t.userId === userId && !t.endedAt).pop();
  if (open) open.endedAt = new Date().toISOString();
  return open;
}

export function openTimeEntry(userId: string) {
  return db().timeEntries.find((t) => t.userId === userId && !t.endedAt);
}

export function toggleAutomation(id: string, armed: boolean) {
  const a = db().automations.find((x) => x.id === id);
  if (a) {
    a.armed = armed;
    if (armed && !a.epochAt) a.epochAt = new Date().toISOString();
  }
  return a;
}

// ------------------------------------------------------- time-relative reads
// These wrap Date.now() so components stay pure — React's lint rule (correctly)
// rejects impure calls in a render body.

export function collectedSince(days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db()
    .payments.filter((p) => p.status === "succeeded" && p.receivedOn >= cutoff)
    .reduce((s, p) => s + p.amountCents, 0);
}

export function nextVisitFor(jobId: string): Visit | undefined {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  return visitsForJob(jobId).find((v) => v.scheduledStart > cutoff);
}

export function daysOverdue(dueDate?: string): number {
  if (!dueDate) return 0;
  return Math.round((Date.now() - Date.parse(dueDate)) / 86_400_000);
}

// ----------------------------------------------------------------- inbound SMS
//
// Telnyx is the system of record for the message itself; this snapshot is the
// working copy the Inbox renders. Everything here is keyed off the last ten
// digits of a phone number, because HubSpot stores them however they were typed.

/** Lead source stamped on clients we first met over SMS. */
export const SMS_LEAD_SOURCE = "Inbound SMS";

export function findClientByPhone(phone: string): Client | undefined {
  const key = phoneKey(phone);
  if (key.length !== 10) return undefined;
  return db().clients.find((c) => phoneKey(c.phone) === key);
}

/** Whoever texted us, as a client row — creating a lead if we've never met them. */
function clientForInbound(from: string): Client {
  const existing = findClientByPhone(from);
  if (existing) return existing;

  const d = db();
  const client: Client = {
    id: `cl_sms_${phoneKey(from)}`,
    name: phoneDisplay(toE164(from)),
    phone: toE164(from),
    type: "residential",
    leadSource: SMS_LEAD_SOURCE,
    // They opened the thread. That is consent to reply, not consent to market.
    smsConsent: false,
    tags: ["sms"],
    createdAt: new Date().toISOString(),
  };
  d.clients.push(client);
  return client;
}

export function conversationForPhone(phone: string): Conversation {
  const d = db();
  const key = phoneKey(phone);
  const existing = d.conversations.find(
    (c) => c.channel === "sms" && phoneKey(c.externalAddress) === key
  );
  if (existing) return existing;

  const client = clientForInbound(phone);
  const conv: Conversation = {
    id: `cv_sms_${key}`,
    clientId: client.id,
    channel: "sms",
    externalAddress: toE164(phone),
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    status: "open",
  };
  d.conversations.push(conv);
  return conv;
}

export function recordInboundSms(opts: {
  from: string;
  body: string;
  receivedAt?: string;
  providerId?: string;
}): { conversation: Conversation; message: Message } {
  const d = db();
  const conv = conversationForPhone(opts.from);
  const createdAt = opts.receivedAt ?? new Date().toISOString();
  const msg: Message = {
    id: `ms_${d.messages.length + 1}`,
    conversationId: conv.id,
    clientId: conv.clientId,
    channel: "sms",
    direction: "inbound",
    body: opts.body,
    createdAt,
    read: false,
    providerId: opts.providerId,
  };
  d.messages.push(msg);
  conv.lastMessageAt = createdAt;
  conv.unreadCount += 1;
  conv.status = "open";
  return { conversation: conv, message: msg };
}

/** A delivery receipt from Telnyx, matched back to the message we sent. */
export function applyDeliveryReceipt(providerId: string, status: Message["deliveryStatus"], error?: string): Message | undefined {
  const msg = db().messages.find((m) => m.providerId === providerId);
  if (!msg) return undefined;
  msg.deliveryStatus = status;
  msg.deliveryError = error;
  return msg;
}

export function setSmsConsent(clientId: string, consented: boolean): Client | undefined {
  const client = getClient(clientId);
  if (!client) return undefined;
  client.smsConsent = consented;
  client.smsOptOutAt = consented ? undefined : new Date().toISOString();
  return client;
}

/**
 * The one place that decides whether a text may leave the building.
 *
 * `reply` is a human answering a thread the customer opened — allowed unless
 * they have opted out. `marketing` needs recorded consent, which no HubSpot
 * contact currently has, so the composer stays honest about it.
 */
export function smsGate(client: Client | undefined, kind: "reply" | "marketing"): { ok: boolean; reason?: string } {
  if (!client) return { ok: false, reason: "No client on this thread." };
  if (client.demo) return { ok: false, reason: "This is a seeded demo client. Sending would text a made-up number." };
  if (!client.phone) return { ok: false, reason: "No mobile number on this client." };
  if (client.smsOptOutAt) return { ok: false, reason: "This client texted STOP. Only they can restart the thread." };
  if (kind === "marketing" && !client.smsConsent) {
    return { ok: false, reason: "No marketing consent on file. Transactional replies still send." };
  }
  return { ok: true };
}
