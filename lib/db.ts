import "server-only";
import { buildSeed } from "@/lib/seed";
import { CRM_LIVE, fetchCrm } from "@/lib/hubspot";
import { dayKey, phoneDisplay, todayKey } from "@/lib/format";
import { phoneKey, toE164 } from "@/lib/telnyx";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { loadSnapshot, promoteClient, promoteRequest } from "@/lib/store";
import { lineItemsFor, priceQuoteOpening, type OpeningSpec } from "@/lib/pricing";
import type {
  Client, Conversation, Invoice, Job, Message, Opening, Payment, Property, Quote,
  Series, ServiceRequest, Snapshot, Staff, Visit,
} from "@/lib/types";

/**
 * Data access.
 *
 * Postgres is the system of record. `lib/store.ts` reads the whole operating
 * set into the flat Snapshot every screen already speaks, and `ensureData()`
 * hydrates it at the top of each render. Reads below are pure functions over
 * that object; writes go to Postgres and mark the snapshot stale.
 *
 * With SUPABASE_URL unset the app still runs — on `lib/seed.ts`, in-process,
 * losing writes at the next cold start. That path exists so a developer can
 * open the app without credentials, not as an operating mode.
 */

export const DB_LIVE = SUPABASE_LIVE;

// The snapshot hangs off globalThis rather than a module binding because Next
// bundles route handlers and page renders separately — two module instances,
// two snapshots. Without this, an SMS written by the Telnyx webhook would be
// invisible to the Inbox that renders it.
const SNAPSHOT = Symbol.for("hydrodam.snapshot");
const HYDRATION = Symbol.for("hydrodam.hydration");

type Hydration = { loadedAt: number; inFlight: Promise<void> | null };
type Host = typeof globalThis & { [SNAPSHOT]?: Snapshot; [HYDRATION]?: Hydration };

const host = () => globalThis as Host;

const hydration = (): Hydration => {
  const h = host();
  if (!h[HYDRATION]) h[HYDRATION] = { loadedAt: 0, inFlight: null };
  return h[HYDRATION];
};

export function db(): Snapshot {
  const h = host();
  if (!h[SNAPSHOT]) {
    // Reached only before the first ensureData(), or with no database
    // configured. Seeded people carry `demo: true` so the two CRM-backed
    // screens can filter them out while jobs can still resolve a name.
    const seeded = buildSeed();
    for (const c of seeded.clients) c.demo = true;
    for (const r of seeded.requests) r.demo = true;
    h[SNAPSHOT] = seeded;
  }
  return h[SNAPSHOT];
}

/**
 * How long a loaded snapshot is reused.
 *
 * Long enough that the dozen `db()` calls in one page render share a single
 * sweep, short enough that a second browser tab sees a colleague's edit
 * without a hard refresh. Every write calls `invalidate()`, so this window
 * never delays your own changes.
 */
const SNAPSHOT_TTL_MS = 2_000;

export function invalidate(): void {
  hydration().loadedAt = 0;
}

// ---------------------------------------------------------------------- CRM
//
// HubSpot holds ~3,000 contacts and remains the lead list. A contact becomes a
// Postgres client only when ops does something durable with it, so the two
// sources are merged for display: Postgres first, then any HubSpot lead that
// has not been promoted.

const CRM_TTL_MS = 5 * 60_000;

/** Forces the next read to go back to HubSpot. Pair with revalidateTag("crm") so the data cache drops too. */
export function invalidateCrm(): void {
  crmLoadedAt = 0;
}

type Crm = Awaited<ReturnType<typeof fetchCrm>>;

let crmCache: Crm = null;
let crmLoadedAt = 0;
let crmInFlight: Promise<void> | null = null;

export const crmStatus = () => ({
  live: CRM_LIVE && crmCache !== null,
  contactCount: crmCache?.contactCount,
  addressedCount: crmCache?.addressedCount,
  paidCount: crmCache?.paidCount,
  fetchedAt: crmCache?.fetchedAt,
});

/** Clients HubSpot marks as won or customer. See `Client["paid"]`. */
export const paidClients = (): Client[] => liveClients().filter((c) => c.paid);

async function ensureCrmCache(): Promise<void> {
  if (!CRM_LIVE) return;
  if (crmCache && Date.now() - crmLoadedAt < CRM_TTL_MS) return;
  if (crmInFlight) return crmInFlight;

  crmInFlight = (async () => {
    try {
      const crm = await fetchCrm();
      if (crm) {
        crmCache = crm;
        crmLoadedAt = Date.now();
      }
    } catch {
      // A CRM outage must never take the dashboard down, and it must not blank
      // the lead list either: the last good snapshot stays in place.
    } finally {
      crmInFlight = null;
    }
  })();

  return crmInFlight;
}

/** Postgres rows first; unpromoted HubSpot leads layered on top for display. */
function mergeCrm(snap: Snapshot): void {
  if (!crmCache) return;

  const promotedContacts = new Set<string>();
  for (const c of snap.clients) if (c.hubspotContactId) promotedContacts.add(c.hubspotContactId);

  const promotedRequests = new Set<string>();
  for (const r of snap.requests) if (r.externalId) promotedRequests.add(r.externalId);

  const leads = crmCache.clients.filter((c) => !c.hubspotContactId || !promotedContacts.has(c.hubspotContactId));
  const leadIds = new Set(leads.map((c) => c.id));

  snap.clients = [...snap.clients, ...leads];
  snap.properties = [...snap.properties, ...crmCache.properties.filter((p) => leadIds.has(p.clientId))];
  snap.requests = [...snap.requests, ...crmCache.requests.filter((r) => !promotedRequests.has(r.id))];
}

/**
 * Hydrates the snapshot. Call once at the top of anything that reads data.
 *
 * Safe to call on every render: within the TTL it is a no-op, and concurrent
 * callers share the one in-flight load rather than each starting their own.
 */
export async function ensureData(): Promise<void> {
  const state = hydration();

  if (!DB_LIVE) {
    db();
    await ensureCrmCache();
    const snap = host()[SNAPSHOT]!;
    // Without Postgres the seed IS the snapshot, so a re-merge would duplicate
    // every lead. Rebuild the CRM half from the seeded rows each time instead.
    snap.clients = snap.clients.filter((c) => c.demo || c.leadSource === SMS_LEAD_SOURCE);
    snap.properties = snap.properties.filter((p) => !p.id.startsWith("hsp_"));
    snap.requests = snap.requests.filter((r) => r.demo);
    mergeCrm(snap);
    return;
  }

  if (Date.now() - state.loadedAt < SNAPSHOT_TTL_MS) return;
  if (state.inFlight) return state.inFlight;

  state.inFlight = (async () => {
    try {
      const [snap] = await Promise.all([loadSnapshot(), ensureCrmCache()]);
      mergeCrm(snap);
      // One assignment at the end: a concurrent render sees either the whole
      // old snapshot or the whole new one, never a half-built object.
      host()[SNAPSHOT] = snap;
      state.loadedAt = Date.now();
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
}

/** Clients and Requests as the two lead-facing screens should see them. */
export const liveClients = (): Client[] => db().clients.filter((c) => !c.demo);
export const liveRequests = (): ServiceRequest[] => db().requests.filter((r) => !r.demo);

// ------------------------------------------------------------------ lookups

/**
 * Lookups accept either id a row has ever had.
 *
 * A HubSpot lead is `hs_<contact>` until ops touches it, at which point it
 * becomes a Postgres uuid and disappears from the merged lead list. Every link
 * already rendered, every bookmark and every in-flight action still carries the
 * old id, so these resolve it rather than 404-ing on work the user just did.
 */
export const getClient = (id: string): Client | undefined =>
  db().clients.find((c) => c.id === id) ??
  (id.startsWith("hs_") ? db().clients.find((c) => c.hubspotContactId === id.slice(3)) : undefined);
export const getProperty = (id: string): Property | undefined => db().properties.find((p) => p.id === id);
export const getQuote = (id: string): Quote | undefined => db().quotes.find((q) => q.id === id);
export const getJob = (id: string): Job | undefined => db().jobs.find((j) => j.id === id);
export const getInvoice = (id: string): Invoice | undefined => db().invoices.find((i) => i.id === id);
export const getVisit = (id: string): Visit | undefined => db().visits.find((v) => v.id === id);
export const getRequest = (id: string): ServiceRequest | undefined =>
  db().requests.find((r) => r.id === id) ??
  (id.startsWith("hsr_") ? db().requests.find((r) => r.externalId === id) : undefined);
export const getStaff = (id: string): Staff | undefined => db().staff.find((s) => s.id === id);
export const getConversation = (id: string): Conversation | undefined => db().conversations.find((c) => c.id === id);

/**
 * How a request is referred to on screen.
 *
 * Only rows in the ledger own a number — it comes from `document_counters` and
 * a person can quote it back to you. A HubSpot lead is numbered in-process
 * from 1000 purely to fill the field, so it both collides with the real
 * sequence (request #1000 was two different people) and shifts whenever the
 * CRM sweep returns contacts in a different order. Never show it as an id.
 */
export const requestRef = (r: ServiceRequest, style: "full" | "short" = "full"): string => {
  if (r.id.startsWith("hsr_")) return style === "full" ? "HubSpot lead" : "lead";
  return style === "full" ? `Request #${r.number}` : `#${r.number}`;
};

export const clientName = (id: string): string => getClient(id)?.name ?? "Unknown client";
export const staffName = (id: string): string => getStaff(id)?.name ?? "Unassigned";

export function propertyFor(clientId: string): Property | undefined {
  const id = getClient(clientId)?.id ?? clientId;
  return db().properties.find((p) => p.clientId === id);
}

export function openingsFor(propertyId: string): Opening[] {
  return db().openings.filter((o) => o.propertyId === propertyId);
}

export function quotesFor(clientId: string): Quote[] {
  return db().quotes.filter((q) => q.clientId === clientId);
}

/**
 * The one quote the customer portal is allowed to talk about.
 *
 * There used to be two answers to "which quote is theirs" — the portal took the
 * newest of everything, the approve page took the newest that was not declined
 * or expired — so a client whose newest quote was declined saw its line items
 * and total, clicked approve, and signed the older one underneath at a
 * different price. One rule, used by both, is the fix.
 *
 * A draft is excluded because it was never presented. That is not a cosmetic
 * point: `api_quote_approve` promotes a draft to sent rather than refusing it,
 * so an internal work-in-progress left visible here was genuinely signable.
 */
export function portalQuote(clientId: string): Quote | undefined {
  return quotesFor(clientId)
    .filter((q) => q.status !== "draft")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Only these two reach `approved`; the rest is history the customer can read. */
export function isApprovable(quote: Quote | undefined): boolean {
  return quote ? ["sent", "viewed"].includes(quote.status) : false;
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

export function quoteFor(requestId: string): Quote | undefined {
  return db().quotes.find((q) => q.requestId === requestId);
}

export function jobForQuote(quoteId: string): Job | undefined {
  return db().jobs.find((j) => j.quoteId === quoteId);
}

export function invoicesForJob(jobId: string): Invoice[] {
  return db().invoices.filter((i) => i.jobId === jobId);
}

export function materialsFor(jobId: string): { id: string; name: string; quantity: number; unit: string; unitCostCents: number }[] {
  return db().materials.filter((m) => m.jobId === jobId);
}

// ------------------------------------------------------------------ schedule

export function visitsBetween(startISO: string, endISO: string): Visit[] {
  return db()
    .visits.filter((v) => v.scheduledStart >= startISO && v.scheduledStart < endISO)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

/**
 * A day means a day where the customer lives. Comparing instants against a
 * midnight computed in the server's timezone put every evening visit on the
 * wrong day once this ran on Vercel, which is UTC.
 */
export function visitsOnKey(key: string): Visit[] {
  return db()
    .visits.filter((v) => v.scheduledStart && dayKey(v.scheduledStart) === key)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

export function visitsOn(date: Date): Visit[] {
  return visitsOnKey(dayKey(date));
}

export function todaysVisits(): Visit[] {
  return visitsOnKey(todayKey());
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
  /** HubSpot contacts that reached Invoice Paid this month, and what that was worth. */
  paidThisMonth: number;
  paidThisMonthCents: number;
  paidThisMonthEstimated: boolean;
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

  const paidMonth = d.clients.filter((c) => c.paid?.at && c.paid.at >= monthStart);
  const paidMonthCents = paidMonth.reduce((s, c) => s + (c.paid?.amountCents ?? 0), 0);

  return {
    openPipelineCents: openQuotes.reduce((s, q) => s + q.totalCents, 0),
    openQuoteCount: openQuotes.length,
    wonThisMonthCents: won.filter((q) => (q.approvedAt ?? "") >= monthStart).reduce((s, q) => s + q.totalCents, 0) + paidMonthCents,
    paidThisMonth: paidMonth.length,
    paidThisMonthCents: paidMonthCents,
    paidThisMonthEstimated: paidMonth.some((c) => c.paid?.estimated),
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
//
// Each of these writes to Postgres and then invalidates the snapshot, so the
// re-render that follows a server action reads the row the database actually
// holds rather than an optimistic copy. Without a database they fall back to
// mutating the snapshot in place, which is enough to click through locally.

/** A HubSpot lead has no Postgres row until ops touches it. This is that touch. */
/**
 * The real clients-table id for something the UI is holding, WITHOUT promoting.
 *
 * `realClientId` creates a client row for a HubSpot lead that does not have one
 * yet, which is right when the caller is about to write something that needs a
 * client. It is wrong for a read, or for a revoke — undefined here means "no
 * such row", not "make one".
 */
export function existingClientId(clientId: string): string | undefined {
  const client = getClient(clientId);
  if (!client) return undefined;
  if (!DB_LIVE || !client.id.startsWith("hs_")) return client.id;
  return db().clients.find((c) => c.hubspotContactId === client.hubspotContactId && !c.id.startsWith("hs_"))?.id;
}

export async function realClientId(clientId: string): Promise<{ clientId: string; propertyId?: string }> {
  const client = getClient(clientId);
  if (!client) throw new Error(`No client ${clientId}`);
  // Already promoted (or never a lead): getClient resolved it to the real row.
  if (!DB_LIVE || !client.id.startsWith("hs_")) {
    return { clientId: client.id, propertyId: propertyFor(client.id)?.id };
  }

  const promoted = await promoteClient(client, propertyFor(client.id));
  invalidate();
  return promoted;
}

/** The same, for a request: returns an id that can carry a quote or a visit. */
export async function realRequestId(requestId: string): Promise<{ requestId: string; clientId: string; propertyId?: string }> {
  const req = getRequest(requestId);
  if (!req) throw new Error(`No request ${requestId}`);
  if (!DB_LIVE || !req.id.startsWith("hsr_")) {
    const { clientId, propertyId } = await realClientId(req.clientId);
    return { requestId: req.id, clientId, propertyId: req.propertyId ?? propertyId };
  }

  const { clientId, propertyId } = await realClientId(req.clientId);
  const id = await promoteRequest(req, clientId, propertyId);
  invalidate();
  return { requestId: id, clientId, propertyId };
}

export async function updateVisit(id: string, patch: Partial<Visit>): Promise<void> {
  if (!DB_LIVE) {
    const v = db().visits.find((x) => x.id === id);
    if (v) Object.assign(v, patch);
    return;
  }
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.crewNotes !== undefined) values.crew_notes = patch.crewNotes;
  if (patch.enRouteAt !== undefined) values.en_route_at = patch.enRouteAt;
  if (patch.checkedInAt !== undefined) values.checked_in_at = patch.checkedInAt;
  if (patch.completedAt !== undefined) values.completed_at = patch.completedAt;
  if (patch.routePosition !== undefined) values.route_position = patch.routePosition;
  if (Object.keys(values).length === 0) return;

  await pg.patch("visits", { id: `eq.${id}` }, values);
  invalidate();
}

export async function moveVisit(id: string, startISO: string, staffIds?: string[]): Promise<void> {
  const v = getVisit(id);
  if (!v) return;
  const durationMs = Math.max(30 * 60_000, Date.parse(v.scheduledEnd) - Date.parse(v.scheduledStart) || 0);
  const endISO = new Date(Date.parse(startISO) + durationMs).toISOString();

  if (!DB_LIVE) {
    v.scheduledStart = startISO;
    v.scheduledEnd = endISO;
    if (staffIds) v.assignedTo = staffIds;
    if (v.status === "unscheduled") v.status = "scheduled";
    return;
  }

  await pg.rpc("api_visit_schedule", {
    p_visit: id,
    p_start: startISO,
    p_end: endISO,
    p_users: staffIds ?? v.assignedTo,
  });
  invalidate();
}

export async function createVisit(opts: {
  jobId?: string;
  requestId?: string;
  kind: Visit["kind"];
  title: string;
  startISO?: string;
  minutes?: number;
  staffIds?: string[];
}): Promise<string | undefined> {
  if (!DB_LIVE) return undefined;
  const end = opts.startISO
    ? new Date(Date.parse(opts.startISO) + (opts.minutes ?? 120) * 60_000).toISOString()
    : null;

  const id = await pg.rpc<string>("api_visit_create", {
    p_job: opts.jobId ?? null,
    p_request: opts.requestId ?? null,
    p_kind: opts.kind,
    p_title: opts.title,
    p_start: opts.startISO ?? null,
    p_end: end,
    p_users: opts.staffIds ?? [],
  });
  invalidate();
  return id;
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<void> {
  if (!DB_LIVE) {
    const j = db().jobs.find((x) => x.id === id);
    if (j) Object.assign(j, patch);
    return;
  }
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.fabricationStatus !== undefined) values.fabrication_status = patch.fabricationStatus;
  if (patch.instructions !== undefined) values.instructions = patch.instructions;
  if (patch.ownerId !== undefined) values.owner_id = patch.ownerId;
  if (Object.keys(values).length === 0) return;

  await pg.patch("jobs", { id: `eq.${id}` }, values);
  invalidate();
}

export async function updateQuote(id: string, patch: Partial<Quote>): Promise<void> {
  if (!DB_LIVE) {
    const q = db().quotes.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
    return;
  }
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    values.status = patch.status;
    if (patch.status === "sent") values.sent_at = new Date().toISOString();
    if (patch.status === "viewed") values.first_viewed_at = new Date().toISOString();
  }
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.ownerId !== undefined) values.owner_id = patch.ownerId;
  if (Object.keys(values).length === 0) return;

  await pg.patch("quotes", { id: `eq.${id}` }, values);
  invalidate();
}

export async function updateRequest(id: string, patch: Partial<ServiceRequest>): Promise<void> {
  if (!DB_LIVE) {
    const r = db().requests.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    return;
  }
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.assignedTo !== undefined) values.assigned_to = patch.assignedTo || null;
  if (patch.details !== undefined) values.details = patch.details;
  if (patch.firstResponseAt !== undefined) values.first_response_at = patch.firstResponseAt;
  if (Object.keys(values).length === 0) return;

  await pg.patch("requests", { id: `eq.${id}` }, values);
  invalidate();
}

export async function updateInvoice(id: string, patch: Partial<Invoice>): Promise<void> {
  if (!DB_LIVE) {
    const i = db().invoices.find((x) => x.id === id);
    if (i) Object.assign(i, patch);
    return;
  }
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    values.status = patch.status;
    if (patch.status === "sent") values.sent_at = new Date().toISOString();
  }
  if (patch.dueDate !== undefined) values.due_date = patch.dueDate;
  if (Object.keys(values).length === 0) return;

  await pg.patch("invoices", { id: `eq.${id}` }, values);
  invalidate();
}

export async function recordPayment(
  invoiceId: string,
  amountCents: number,
  method: Payment["method"],
  reference?: string
): Promise<void> {
  if (!DB_LIVE) {
    const d = db();
    const inv = d.invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    d.payments.push({
      id: `pay_${d.payments.length + 1}`,
      invoiceId,
      clientId: inv.clientId,
      method,
      status: method === "ach" ? "processing" : "succeeded",
      amountCents,
      feeCents: method === "ach" ? 500 : method === "card" ? Math.round(amountCents * 0.029) + 30 : 0,
      receivedOn: new Date().toISOString().slice(0, 10),
    });
    if (method !== "ach") {
      inv.amountPaidCents = Math.min(inv.totalCents, inv.amountPaidCents + amountCents);
      inv.status = inv.amountPaidCents >= inv.totalCents ? "paid" : "partially_paid";
    }
    return;
  }

  await pg.rpc("api_payment_record", {
    p_invoice: invoiceId,
    p_method: method,
    p_amount_cents: amountCents,
    p_reference: reference ?? null,
  });
  invalidate();
}

export async function createInvoice(
  jobId: string,
  kind: Invoice["kind"],
  amountCents?: number,
  title?: string
): Promise<string | undefined> {
  if (!DB_LIVE) return undefined;
  const id = await pg.rpc<string>("api_invoice_create", {
    p_job: jobId,
    p_kind: kind,
    p_amount_cents: amountCents ?? null,
    p_title: title ?? null,
    p_net_days: 7,
  });
  invalidate();
  return id;
}

export async function approveQuote(quoteId: string, signerName: string, ip: string, userAgent: string, version: string, consentText: string): Promise<void> {
  if (!DB_LIVE) {
    const q = db().quotes.find((x) => x.id === quoteId);
    if (q) {
      q.status = "approved";
      q.approvedAt = new Date().toISOString();
      q.approvedByName = signerName;
    }
    return;
  }
  await pg.rpc("api_quote_approve", {
    p_quote: quoteId,
    p_signer_name: signerName,
    p_ip: ip,
    p_user_agent: userAgent,
    p_agreement_version: version,
    p_esign_consent: consentText,
  });
  invalidate();
}

/**
 * The service address.
 *
 * HubSpot holds a street address for 140 of ~3,000 contacts, so for most leads
 * this is where the address first exists. Writing one promotes the lead to a
 * real client, because a property has to hang off a row that will still be
 * there tomorrow.
 */
export async function saveProperty(
  clientId: string,
  values: {
    label?: string;
    address: string;
    city: string;
    postalCode: string;
    floodZone?: string;
    crsClass?: number;
    accessNotes?: string;
  }
): Promise<string | undefined> {
  if (!DB_LIVE) return undefined;
  const { clientId: realId, propertyId } = await realClientId(clientId);

  const row = {
    label: values.label || "Service address",
    address_line1: values.address,
    city: values.city,
    state: "FL",
    postal_code: values.postalCode,
    flood_zone: values.floodZone || null,
    crs_class: values.crsClass ?? null,
    access_notes: values.accessNotes || null,
  };

  if (propertyId) {
    await pg.patch("properties", { id: `eq.${propertyId}` }, row);
    invalidate();
    return propertyId;
  }

  const company = await pg.rpc<string>("company_id", {});
  const [created] = await pg.insert<{ id: string }>("properties", {
    company_id: company,
    client_id: realId,
    is_primary: true,
    ...row,
  });
  invalidate();
  return created.id;
}

/** One protectable opening, measured on site. This is what a quote prices. */
export async function addOpening(
  propertyId: string,
  values: { label: string; type: Opening["type"]; widthIn: number; protectionHeightIn: number; surface?: string }
): Promise<void> {
  if (!DB_LIVE) return;
  const company = await pg.rpc<string>("company_id", {});
  const existing = openingsFor(propertyId).length;

  await pg.insert("openings", {
    company_id: company,
    property_id: propertyId,
    label: values.label,
    type: values.type,
    width_in: values.widthIn,
    protection_height_in: values.protectionHeightIn,
    surface: values.surface || null,
    sort_order: existing,
  });
  invalidate();
}

export async function removeOpening(id: string): Promise<void> {
  if (!DB_LIVE) return;
  await pg.remove("openings", { id: `eq.${id}` });
  invalidate();
}

/**
 * Prices a set of openings and writes the quote, its openings and its lines in
 * one transaction. The arithmetic lives in lib/pricing.ts so the office and the
 * public estimator quote the same opening at the same number.
 */
export async function createQuote(opts: {
  clientId: string;
  propertyId: string;
  requestId?: string;
  title: string;
  series: Series;
  specs: OpeningSpec[];
  depositBps?: number;
  discountCents?: number;
}): Promise<string | undefined> {
  if (!DB_LIVE) return undefined;

  const openings = opts.specs.map((s) => {
    const priced = priceQuoteOpening(s);
    return {
      opening_id: s.openingId ?? null,
      label: priced.label,
      type: priced.type,
      width_in: priced.widthIn,
      protection_height_in: priced.protectionHeightIn,
      quantity: priced.quantity,
      series: priced.series,
      panel_count: priced.panelCount,
      post_count: priced.postCount,
      center_post_required: priced.centerPostRequired,
      line_total_cents: priced.lineTotalCents,
    };
  });

  const lines = lineItemsFor(opts.specs).map((l) => ({
    kind: l.kind,
    name: l.name,
    quantity: l.quantity,
    unit: l.unit,
    unit_price_cents: l.unitPriceCents,
    unit_cost_cents: l.unitCostCents,
    is_taxable: l.taxable,
    optional: l.optional,
    selected: l.selected,
  }));

  const id = await pg.rpc<string>("api_quote_create", {
    p_client: opts.clientId,
    p_property: opts.propertyId,
    p_request: opts.requestId ?? null,
    p_title: opts.title,
    p_series: opts.series,
    p_openings: openings,
    p_lines: lines,
    p_deposit_bps: opts.depositBps ?? 5000,
    p_discount_cents: opts.discountCents ?? 0,
    p_valid_days: 30,
  });
  invalidate();
  return id;
}

export async function convertQuoteToJob(quoteId: string): Promise<string | undefined> {
  if (!DB_LIVE) return undefined;
  const id = await pg.rpc<string>("api_quote_to_job", { p_quote: quoteId });
  invalidate();
  return id;
}

export async function sendMessage(
  conversationId: string,
  body: string,
  meta?: { providerId?: string; deliveryStatus?: Message["deliveryStatus"]; templateKey?: string }
): Promise<Message | undefined> {
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

export async function saveChecklist(
  jobId: string | undefined,
  visitId: string,
  answers: Record<string, string>,
  submit: boolean,
  by: string
) {
  if (!DB_LIVE) {
    const d = db();
    let sub = d.submissions.find((s) => s.visitId === visitId && s.templateKey === "qa_checklist");
    if (!sub) {
      sub = {
        id: `fs_${d.submissions.length + 1}`,
        templateKey: "qa_checklist",
        jobId,
        visitId,
        clientId: getVisit(visitId)?.clientId ?? "",
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

  await pg.rpc("api_checklist_save", {
    p_visit: visitId,
    p_answers: answers,
    p_submit: submit,
    p_by: by,
  });
  invalidate();
}

export function checklistFor(visitId: string) {
  return db().submissions.find((s) => s.visitId === visitId && s.templateKey === "qa_checklist");
}

export function checklistForJob(jobId: string) {
  return db().submissions.find((s) => s.jobId === jobId && s.templateKey === "qa_checklist" && s.status === "submitted");
}

export async function clockIn(userId: string, jobId?: string, visitId?: string) {
  if (!DB_LIVE) {
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
  await pg.rpc("api_clock_in", {
    p_user: userId,
    p_job: jobId ?? null,
    p_visit: visitId ?? null,
    p_activity: "install",
  });
  invalidate();
}

export async function clockOut(userId: string) {
  if (!DB_LIVE) {
    const open = db().timeEntries.filter((t) => t.userId === userId && !t.endedAt).pop();
    if (open) open.endedAt = new Date().toISOString();
    return open;
  }
  await pg.rpc("api_clock_out", { p_user: userId, p_break_minutes: 0 });
  invalidate();
}

export function openTimeEntry(userId: string) {
  return db().timeEntries.find((t) => t.userId === userId && !t.endedAt);
}

export async function toggleAutomation(id: string, armed: boolean) {
  if (!DB_LIVE) {
    const a = db().automations.find((x) => x.id === id);
    if (a) {
      a.armed = armed;
      if (armed && !a.epochAt) a.epochAt = new Date().toISOString();
    }
    return;
  }
  await pg.rpc("api_automation_toggle", { p_id: id, p_armed: armed });
  invalidate();
}

export async function addTeammate(opts: {
  name: string;
  email: string;
  phone?: string;
  role: Staff["role"];
  costRateCentsPerHour: number;
}): Promise<void> {
  if (!DB_LIVE) return;
  const company = await pg.rpc<string>("company_id", {});
  await pg.insert(
    "users",
    {
      company_id: company,
      full_name: opts.name,
      email: opts.email,
      phone: opts.phone || null,
      role: opts.role,
      cost_rate_cents_per_hour: opts.costRateCentsPerHour,
      color: CREW_COLORS[Math.abs(hash(opts.email)) % CREW_COLORS.length],
    },
    { onConflict: "company_id,email" }
  );
  invalidate();
}

export async function setTeammateActive(id: string, active: boolean): Promise<void> {
  if (!DB_LIVE) return;
  await pg.patch("users", { id: `eq.${id}` }, { is_active: active });
  invalidate();
}

const CREW_COLORS = ["#1f8ab3", "#cc551e", "#2fbf71", "#bf7c58", "#7eabb9", "#9b6dd6"];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

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

export const nowISO = (): string => new Date().toISOString();

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
  if (kind === "marketing" && !client.smsMarketingConsent) {
    return { ok: false, reason: "No marketing consent on file. Transactional replies still send." };
  }
  return { ok: true };
}

/** Kept for call sites that predate ensureData(). */
export const ensureCrm = ensureData;
