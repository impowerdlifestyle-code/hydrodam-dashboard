import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import type {
  Automation, Client, Conversation, FormSubmission, Invoice, Job, JobMaterial, LineItem,
  Message, Opening, Payment, Property, Quote, QuoteOpening, ServiceRequest, Snapshot,
  Staff, TimeEntry, Visit,
} from "@/lib/types";

/**
 * The Postgres system of record, read into the one Snapshot shape the whole app
 * already speaks.
 *
 * Every screen was written against a flat in-memory snapshot. Rather than
 * rewrite forty components into per-screen queries, this loads the operating
 * set — which is small, because a barrier company runs tens of jobs a year, not
 * millions — in one parallel sweep and hands back exactly the object the seed
 * used to produce. Callers cannot tell the difference.
 *
 * The one thing NOT loaded here is the lead list. HubSpot holds ~3,000 contacts
 * and remains their system of record; a contact becomes a row in `clients` only
 * when ops actually touches it (see promoteClient). Postgres therefore holds
 * people we have done business with, and HubSpot holds people we have not.
 */

export const COMPANY_SLUG = "hydrodam";

// ------------------------------------------------------------------ row types

type UserRow = {
  id: string; full_name: string; email: string; phone: string | null;
  role: Staff["role"]; color: string | null; cost_rate_cents_per_hour: number; is_active: boolean;
};

type ClientRow = {
  id: string; display_name: string; email: string | null; phone: string | null;
  type: Client["type"]; lead_source: string; tags: string[]; created_at: string;
  hubspot_contact_id: string | null;
};

type ConsentRow = { client_id: string | null; channel: string; granted: boolean; wording: string | null; occurred_at: string };

type PropertyRow = {
  id: string; client_id: string; label: string | null; address_line1: string;
  city: string; state: string; postal_code: string; flood_zone: string | null;
  crs_class: number | null; access_notes: string | null;
};

type OpeningRow = {
  id: string; property_id: string; label: string; type: Opening["type"];
  width_in: string | null; protection_height_in: string | null; surface: string | null;
};

type RequestRow = {
  id: string; number: number; client_id: string | null; property_id: string | null;
  status: ServiceRequest["status"]; source: string; title: string; details: string | null;
  estimate_low_cents: number | null; estimate_high_cents: number | null;
  assigned_to: string | null; created_at: string; first_response_at: string | null;
  external_id: string | null; hubspot_deal_id: string | null;
};

type QuoteOpeningRow = {
  id: string; label: string; type: QuoteOpening["type"]; width_in: string;
  protection_height_in: string; quantity: number; series: QuoteOpening["series"];
  panel_count: number; post_count: number; center_post_required: boolean;
  line_total_cents: number; sort_order: number;
};

type LineItemRow = {
  id: string; kind: string; name: string; quantity: string; unit: string;
  unit_price_cents: number; unit_cost_cents: number | null; is_taxable: boolean;
  optional: boolean | null; selected: boolean | null; sort_order: number;
};

type QuoteRow = {
  id: string; number: number; client_id: string; property_id: string; request_id: string | null;
  status: Quote["status"]; title: string; primary_series: Quote["primarySeries"] | null;
  subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number;
  deposit_percent_bps: number; deposit_due_cents: number; valid_until: string | null;
  sent_at: string | null; first_viewed_at: string | null; approved_at: string | null;
  approved_by_name: string | null; owner_id: string | null; created_at: string;
  quote_openings: QuoteOpeningRow[]; quote_line_items: LineItemRow[];
};

type JobRow = {
  id: string; number: number; quote_id: string | null; client_id: string; property_id: string;
  status: Job["status"]; title: string; instructions: string | null;
  fabrication_status: Job["fabricationStatus"]; scheduled_start: string | null;
  completed_at: string | null; warranty_ends_on: string | null; owner_id: string | null;
  contract_cents: number; created_at: string;
};

type VisitRow = {
  id: string; job_id: string | null; request_id: string | null; client_id: string;
  property_id: string; kind: Visit["kind"]; status: Visit["status"]; title: string | null;
  sequence: number; scheduled_start: string | null; scheduled_end: string | null;
  route_position: number | null; en_route_at: string | null; checked_in_at: string | null;
  completed_at: string | null; crew_notes: string | null;
  visit_assignments: { user_id: string }[];
};

type TimeEntryRow = {
  id: string; user_id: string; job_id: string | null; visit_id: string | null;
  started_at: string; ended_at: string | null; break_minutes: number;
  activity: string; cost_rate_cents_per_hour: number;
};

type MaterialRow = {
  id: string; job_id: string; name: string; quantity: string; unit: string; unit_cost_cents: number;
};

type InvoiceRow = {
  id: string; number: number; kind: Invoice["kind"]; status: Invoice["status"];
  client_id: string; job_id: string | null; quote_id: string | null; title: string | null;
  subtotal_cents: number; tax_cents: number; total_cents: number; amount_paid_cents: number;
  issue_date: string | null; due_date: string | null; sent_at: string | null; paid_at: string | null;
  invoice_line_items: LineItemRow[];
};

type PaymentRow = {
  id: string; invoice_id: string; client_id: string; method: Payment["method"];
  status: string; amount_cents: number; fee_cents: number; received_on: string;
  expected_settlement_on: string | null; last4: string | null; brand: string | null;
};

type ConversationRow = {
  id: string; client_id: string | null; channel: "sms" | "email"; external_address: string;
  last_message_at: string | null; unread_count: number; status: string;
};

type MessageRow = {
  id: string; conversation_id: string; client_id: string | null; channel: "sms" | "email";
  direction: "inbound" | "outbound"; status: string; body_text: string | null;
  template_key: string | null; provider_message_id: string | null; error_message: string | null;
  read_at: string | null; created_at: string;
};

type SubmissionRow = {
  id: string; template_key: string; job_id: string | null; visit_id: string | null;
  client_id: string | null; status: string; answers: Record<string, string>;
  submitted_at: string | null; submitted_by_name: string | null;
};

type AutomationRow = {
  id: string; automation_id: string; name: string; trigger_event: string;
  epoch_at: string | null; armed: boolean; max_sends_per_run: number;
  offsets_days: number[]; channels: ("sms" | "email")[]; requires_consent: string | null;
};

// ------------------------------------------------------------------- mappers

const num = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v));

const DELIVERY: Record<string, Message["deliveryStatus"]> = {
  queued: "queued", sending: "queued", sent: "sent",
  delivered: "delivered", failed: "failed", bounced: "failed",
};

const toStaff = (r: UserRow): Staff => ({
  id: r.id,
  name: r.full_name,
  email: r.email,
  phone: r.phone ?? undefined,
  role: r.role,
  color: r.color ?? "#7eabb9",
  costRateCentsPerHour: num(r.cost_rate_cents_per_hour),
  active: r.is_active,
});

const toClient = (r: ClientRow, consent?: { granted: boolean; wording?: string; at: string }): Client => ({
  id: r.id,
  name: r.display_name,
  email: r.email ?? undefined,
  phone: r.phone ?? undefined,
  type: r.type,
  leadSource: r.lead_source,
  smsConsent: consent?.granted ?? false,
  smsConsentWording: consent?.granted ? consent.wording : undefined,
  smsOptOutAt: consent && !consent.granted ? consent.at : undefined,
  tags: r.tags ?? [],
  createdAt: r.created_at,
  hubspotContactId: r.hubspot_contact_id ?? undefined,
});

const toProperty = (r: PropertyRow): Property => ({
  id: r.id,
  clientId: r.client_id,
  label: r.label ?? "Property",
  address: r.address_line1,
  city: r.city,
  state: r.state,
  postalCode: r.postal_code,
  floodZone: (r.flood_zone as Property["floodZone"]) ?? undefined,
  crsClass: r.crs_class ?? undefined,
  accessNotes: r.access_notes ?? undefined,
});

const toOpening = (r: OpeningRow): Opening => ({
  id: r.id,
  propertyId: r.property_id,
  label: r.label,
  type: r.type,
  widthIn: num(r.width_in),
  protectionHeightIn: num(r.protection_height_in),
  surface: r.surface ?? undefined,
});

const toRequest = (r: RequestRow): ServiceRequest => ({
  id: r.id,
  number: r.number,
  clientId: r.client_id ?? "",
  propertyId: r.property_id ?? undefined,
  status: r.status,
  source: r.source,
  title: r.title,
  details: r.details ?? undefined,
  estimateLowCents: r.estimate_low_cents ?? undefined,
  estimateHighCents: r.estimate_high_cents ?? undefined,
  assignedTo: r.assigned_to ?? undefined,
  createdAt: r.created_at,
  firstResponseAt: r.first_response_at ?? undefined,
  externalId: r.external_id ?? undefined,
});

// `allowance` exists in the pricebook but the UI only knows four kinds; it
// prices like a fee, so it renders as one.
const LINE_KIND: Record<string, LineItem["kind"]> = {
  material: "material", labor: "labor", fee: "fee",
  discount: "discount", allowance: "fee", deposit_credit: "discount",
};

const toLineItem = (r: LineItemRow): LineItem => ({
  id: r.id,
  kind: LINE_KIND[r.kind] ?? "material",
  name: r.name,
  quantity: num(r.quantity),
  unit: r.unit,
  unitPriceCents: num(r.unit_price_cents),
  unitCostCents: num(r.unit_cost_cents),
  taxable: r.is_taxable,
  optional: r.optional ?? false,
  selected: r.selected ?? true,
});

const toQuote = (r: QuoteRow): Quote => ({
  id: r.id,
  number: r.number,
  clientId: r.client_id,
  propertyId: r.property_id,
  requestId: r.request_id ?? undefined,
  status: r.status,
  title: r.title,
  primarySeries: r.primary_series ?? "sentinel",
  openings: [...(r.quote_openings ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => ({
      id: o.id,
      label: o.label,
      type: o.type,
      widthIn: num(o.width_in),
      protectionHeightIn: num(o.protection_height_in),
      quantity: o.quantity,
      series: o.series,
      panelCount: o.panel_count,
      postCount: o.post_count,
      centerPostRequired: o.center_post_required,
      lineTotalCents: num(o.line_total_cents),
    })),
  lineItems: [...(r.quote_line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(toLineItem),
  subtotalCents: num(r.subtotal_cents),
  discountCents: num(r.discount_cents),
  taxCents: num(r.tax_cents),
  totalCents: num(r.total_cents),
  depositPercentBps: r.deposit_percent_bps,
  depositDueCents: num(r.deposit_due_cents),
  validUntil: r.valid_until ?? "",
  sentAt: r.sent_at ?? undefined,
  viewedAt: r.first_viewed_at ?? undefined,
  approvedAt: r.approved_at ?? undefined,
  approvedByName: r.approved_by_name ?? undefined,
  ownerId: r.owner_id ?? undefined,
  createdAt: r.created_at,
});

const toJob = (r: JobRow): Job => ({
  id: r.id,
  number: r.number,
  quoteId: r.quote_id ?? undefined,
  clientId: r.client_id,
  propertyId: r.property_id,
  status: r.status,
  title: r.title,
  instructions: r.instructions ?? undefined,
  fabricationStatus: r.fabrication_status,
  scheduledStart: r.scheduled_start ?? undefined,
  completedAt: r.completed_at ?? undefined,
  warrantyEndsOn: r.warranty_ends_on ?? undefined,
  ownerId: r.owner_id ?? undefined,
  contractCents: num(r.contract_cents),
  createdAt: r.created_at,
});

const toVisit = (r: VisitRow): Visit => ({
  id: r.id,
  jobId: r.job_id ?? undefined,
  requestId: r.request_id ?? undefined,
  clientId: r.client_id,
  propertyId: r.property_id,
  kind: r.kind,
  status: r.status,
  title: r.title ?? "Visit",
  sequence: r.sequence,
  scheduledStart: r.scheduled_start ?? "",
  scheduledEnd: r.scheduled_end ?? "",
  assignedTo: (r.visit_assignments ?? []).map((a) => a.user_id),
  routePosition: r.route_position ?? undefined,
  enRouteAt: r.en_route_at ?? undefined,
  checkedInAt: r.checked_in_at ?? undefined,
  completedAt: r.completed_at ?? undefined,
  crewNotes: r.crew_notes ?? undefined,
});

const toTimeEntry = (r: TimeEntryRow): TimeEntry => ({
  id: r.id,
  userId: r.user_id,
  jobId: r.job_id ?? undefined,
  visitId: r.visit_id ?? undefined,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? undefined,
  breakMinutes: r.break_minutes,
  activity: (r.activity === "break" ? "admin" : r.activity) as TimeEntry["activity"],
  costRateCentsPerHour: num(r.cost_rate_cents_per_hour),
});

const toMaterial = (r: MaterialRow): JobMaterial => ({
  id: r.id,
  jobId: r.job_id,
  name: r.name,
  quantity: num(r.quantity),
  unit: r.unit,
  unitCostCents: num(r.unit_cost_cents),
});

const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  status: r.status,
  clientId: r.client_id,
  jobId: r.job_id ?? undefined,
  quoteId: r.quote_id ?? undefined,
  title: r.title ?? `Invoice #${r.number}`,
  lineItems: [...(r.invoice_line_items ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(toLineItem),
  subtotalCents: num(r.subtotal_cents),
  taxCents: num(r.tax_cents),
  totalCents: num(r.total_cents),
  amountPaidCents: num(r.amount_paid_cents),
  issueDate: r.issue_date ?? undefined,
  dueDate: r.due_date ?? undefined,
  sentAt: r.sent_at ?? undefined,
  paidAt: r.paid_at ?? undefined,
});

// A refund is still money that arrived; the refunded amount is tracked on the
// invoice, so collapsing it to succeeded here keeps the ledger honest.
const PAYMENT_STATUS: Record<string, Payment["status"]> = {
  processing: "processing", succeeded: "succeeded", failed: "failed", refunded: "succeeded",
};

const toPayment = (r: PaymentRow): Payment => ({
  id: r.id,
  invoiceId: r.invoice_id,
  clientId: r.client_id,
  method: r.method,
  status: PAYMENT_STATUS[r.status] ?? "processing",
  amountCents: num(r.amount_cents),
  feeCents: num(r.fee_cents),
  receivedOn: r.received_on,
  expectedSettlementOn: r.expected_settlement_on ?? undefined,
  last4: r.last4 ?? undefined,
  brand: r.brand ?? undefined,
});

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  clientId: r.client_id ?? "",
  channel: r.channel,
  externalAddress: r.external_address,
  lastMessageAt: r.last_message_at ?? new Date(0).toISOString(),
  unreadCount: r.unread_count,
  status: r.status === "closed" ? "closed" : "open",
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  clientId: r.client_id ?? "",
  channel: r.channel,
  direction: r.direction,
  body: r.body_text ?? "",
  createdAt: r.created_at,
  read: r.direction === "outbound" || r.read_at !== null,
  templateKey: r.template_key ?? undefined,
  providerId: r.provider_message_id ?? undefined,
  deliveryStatus: r.direction === "outbound" ? DELIVERY[r.status] : undefined,
  deliveryError: r.error_message ?? undefined,
});

const toSubmission = (r: SubmissionRow): FormSubmission => ({
  id: r.id,
  templateKey: r.template_key as FormSubmission["templateKey"],
  jobId: r.job_id ?? undefined,
  visitId: r.visit_id ?? undefined,
  clientId: r.client_id ?? "",
  status: r.status === "submitted" ? "submitted" : "draft",
  answers: r.answers ?? {},
  submittedAt: r.submitted_at ?? undefined,
  submittedByName: r.submitted_by_name ?? undefined,
});

const toAutomation = (r: AutomationRow, sent: number): Automation => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger_event,
  channels: r.channels ?? [],
  offsetsDays: r.offsets_days ?? [],
  armed: r.armed,
  epochAt: r.epoch_at ?? undefined,
  maxSendsPerRun: r.max_sends_per_run,
  requiresConsent: r.requires_consent ?? undefined,
  sentLast30d: sent,
});

// ------------------------------------------------------------------- company

let companyIdCache: string | null = null;

export async function companyId(): Promise<string> {
  if (companyIdCache) return companyIdCache;
  const [row] = await pg.select<{ id: string }>("companies", {
    select: "id", slug: `eq.${COMPANY_SLUG}`, limit: "1",
  });
  if (!row) throw new Error(`No company with slug "${COMPANY_SLUG}". Run supabase/bootstrap.sql.`);
  companyIdCache = row.id;
  return companyIdCache;
}

/** The published version a submission of this template must be written against. */
export async function formVersionId(templateKey: string): Promise<string> {
  const [row] = await pg.select<{ id: string }>("form_versions", {
    select: "id,version,form_templates!inner(key)",
    "form_templates.key": `eq.${templateKey}`,
    order: "version.desc",
    limit: "1",
  });
  if (!row) throw new Error(`No published form version for "${templateKey}". Run supabase/seed-reference.mjs.`);
  return row.id;
}

// ---------------------------------------------------------------------- load

const COLS = {
  users: "id,full_name,email,phone,role,color,cost_rate_cents_per_hour,is_active",
  clients: "id,display_name,email,phone,type,lead_source,tags,created_at,hubspot_contact_id",
  properties: "id,client_id,label,address_line1,city,state,postal_code,flood_zone,crs_class,access_notes",
  openings: "id,property_id,label,type,width_in,protection_height_in,surface",
  requests:
    "id,number,client_id,property_id,status,source,title,details,estimate_low_cents,estimate_high_cents,assigned_to,created_at,first_response_at,external_id,hubspot_deal_id",
  quotes:
    "id,number,client_id,property_id,request_id,status,title,primary_series,subtotal_cents,discount_cents,tax_cents,total_cents,deposit_percent_bps,deposit_due_cents,valid_until,sent_at,first_viewed_at,approved_at,approved_by_name,owner_id,created_at," +
    "quote_openings(id,label,type,width_in,protection_height_in,quantity,series,panel_count,post_count,center_post_required,line_total_cents,sort_order)," +
    "quote_line_items(id,kind,name,quantity,unit,unit_price_cents,unit_cost_cents,is_taxable,optional,selected,sort_order)",
  jobs:
    "id,number,quote_id,client_id,property_id,status,title,instructions,fabrication_status,scheduled_start,completed_at,warranty_ends_on,owner_id,contract_cents,created_at",
  visits:
    "id,job_id,request_id,client_id,property_id,kind,status,title,sequence,scheduled_start,scheduled_end,route_position,en_route_at,checked_in_at,completed_at,crew_notes,visit_assignments(user_id)",
  time_entries: "id,user_id,job_id,visit_id,started_at,ended_at,break_minutes,activity,cost_rate_cents_per_hour",
  job_materials: "id,job_id,name,quantity,unit,unit_cost_cents",
  invoices:
    "id,number,kind,status,client_id,job_id,quote_id,title,subtotal_cents,tax_cents,total_cents,amount_paid_cents,issue_date,due_date,sent_at,paid_at," +
    "invoice_line_items(id,kind,name,quantity,unit,unit_price_cents,is_taxable,sort_order)",
  payments:
    "id,invoice_id,client_id,method,status,amount_cents,fee_cents,received_on,expected_settlement_on,last4,brand",
  conversations: "id,client_id,channel,external_address,last_message_at,unread_count,status",
  messages:
    "id,conversation_id,client_id,channel,direction,status,body_text,template_key,provider_message_id,error_message,read_at,created_at",
  form_submissions: "id,template_key,job_id,visit_id,client_id,status,answers,submitted_at,submitted_by_name",
  automation_config:
    "id,automation_id,name,trigger_event,epoch_at,armed,max_sends_per_run,offsets_days,channels,requires_consent",
} as const;

const thirtyDaysAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

/**
 * The whole operating set, in one parallel sweep.
 *
 * PostgREST caps a response at 1,000 rows by default, so the two tables that
 * can realistically exceed that — messages and time entries — are bounded by
 * recency rather than by nothing. Everything else is orders of magnitude
 * smaller than the cap.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const [
    users, clients, consents, properties, openings, requests, quotes, jobs, visits,
    timeEntries, materials, invoices, payments, conversations, messages, submissions,
    automations, sends,
  ] = await Promise.all([
    pg.select<UserRow>("users", { select: COLS.users, order: "role.asc,full_name.asc" }),
    pg.select<ClientRow>("clients", { select: COLS.clients, archived_at: "is.null", order: "created_at.desc", limit: "1000" }),
    pg.select<ConsentRow>("v_current_consent", { select: "client_id,channel,granted,wording,occurred_at", channel: "eq.sms_marketing" }),
    pg.select<PropertyRow>("properties", { select: COLS.properties, limit: "1000" }),
    pg.select<OpeningRow>("openings", { select: COLS.openings, order: "sort_order.asc", limit: "1000" }),
    pg.select<RequestRow>("requests", { select: COLS.requests, order: "created_at.desc", limit: "1000" }),
    pg.select<QuoteRow>("quotes", { select: COLS.quotes, order: "created_at.desc", limit: "500" }),
    pg.select<JobRow>("jobs", { select: COLS.jobs, order: "created_at.desc", limit: "500" }),
    pg.select<VisitRow>("visits", { select: COLS.visits, order: "scheduled_start.asc.nullsfirst", limit: "1000" }),
    pg.select<TimeEntryRow>("time_entries", { select: COLS.time_entries, order: "started_at.desc", limit: "1000" }),
    pg.select<MaterialRow>("job_materials", { select: COLS.job_materials, limit: "1000" }),
    pg.select<InvoiceRow>("invoices", { select: COLS.invoices, order: "created_at.desc", limit: "500" }),
    pg.select<PaymentRow>("payments", { select: COLS.payments, order: "received_on.desc", limit: "1000" }),
    pg.select<ConversationRow>("conversations", { select: COLS.conversations, order: "last_message_at.desc.nullslast", limit: "300" }),
    pg.select<MessageRow>("messages", { select: COLS.messages, order: "created_at.desc", limit: "1000" }),
    pg.select<SubmissionRow>("form_submissions", { select: COLS.form_submissions, order: "created_at.desc", limit: "500" }),
    pg.select<AutomationRow>("automation_config", { select: COLS.automation_config, order: "created_at.asc" }),
    pg.select<{ automation_id: string }>("message_sends", {
      select: "automation_id", status: "eq.sent", sent_at: `gte.${thirtyDaysAgo()}`, limit: "1000",
    }),
  ]);

  const consentFor = new Map<string, { granted: boolean; wording?: string; at: string }>();
  for (const c of consents) {
    if (c.client_id) consentFor.set(c.client_id, { granted: c.granted, wording: c.wording ?? undefined, at: c.occurred_at });
  }

  const sentPerAutomation = new Map<string, number>();
  for (const s of sends) sentPerAutomation.set(s.automation_id, (sentPerAutomation.get(s.automation_id) ?? 0) + 1);

  return {
    connected: true,
    staff: users.map(toStaff),
    clients: clients.map((c) => toClient(c, consentFor.get(c.id))),
    properties: properties.map(toProperty),
    openings: openings.map(toOpening),
    requests: requests.map(toRequest),
    quotes: quotes.map(toQuote),
    jobs: jobs.map(toJob),
    visits: visits.map(toVisit),
    timeEntries: timeEntries.map(toTimeEntry),
    materials: materials.map(toMaterial),
    invoices: invoices.map(toInvoice),
    payments: payments.map(toPayment),
    conversations: conversations.map(toConversation),
    // Loaded newest-first so the cap keeps recent traffic; the app reads them
    // oldest-first inside a thread.
    messages: messages.map(toMessage).reverse(),
    submissions: submissions.map(toSubmission),
    automations: automations.map((a) => toAutomation(a, sentPerAutomation.get(a.automation_id) ?? 0)),
  };
}

/** The set of HubSpot ids already promoted, so the lead-list merge can skip them. */
export function promotedHubspotIds(snap: Snapshot): Set<string> {
  const ids = new Set<string>();
  for (const c of snap.clients) if (c.hubspotContactId) ids.add(c.hubspotContactId);
  return ids;
}

// ----------------------------------------------------------------- promotion

/**
 * Turn a HubSpot lead into a real client row.
 *
 * Called the moment ops does something durable with a person — books an
 * assessment, writes a quote, opens a job. Idempotent on the HubSpot id, so a
 * double-click cannot fork someone into two clients.
 */
export async function promoteClient(lead: Client, property?: Property): Promise<{ clientId: string; propertyId?: string }> {
  const company = await companyId();

  if (lead.hubspotContactId) {
    const [existing] = await pg.select<{ id: string }>("clients", {
      select: "id", hubspot_contact_id: `eq.${lead.hubspotContactId}`, limit: "1",
    });
    if (existing) return { clientId: existing.id, propertyId: await propertyIdFor(existing.id, property) };
  }

  // A name is one text field in HubSpot and two columns here. Splitting on the
  // last space keeps compound first names intact and is right far more often
  // than splitting on the first.
  const parts = lead.name.trim().split(/\s+/);
  const isPerson = lead.type === "residential" && parts.length > 1;

  const [created] = await pg.insert<{ id: string }>("clients", {
    company_id: company,
    type: lead.type,
    first_name: isPerson ? parts.slice(0, -1).join(" ") : lead.name,
    last_name: isPerson ? parts.at(-1) : null,
    company_name: lead.type === "residential" ? null : lead.name,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    lead_source: lead.leadSource,
    tags: lead.tags ?? [],
    hubspot_contact_id: lead.hubspotContactId ?? null,
  });

  return { clientId: created.id, propertyId: await propertyIdFor(created.id, property) };
}

async function propertyIdFor(clientId: string, property?: Property): Promise<string | undefined> {
  const [existing] = await pg.select<{ id: string }>("properties", {
    select: "id", client_id: `eq.${clientId}`, order: "is_primary.desc,created_at.asc", limit: "1",
  });
  if (existing) return existing.id;
  if (!property) return undefined;

  const company = await companyId();
  const [created] = await pg.insert<{ id: string }>("properties", {
    company_id: company,
    client_id: clientId,
    label: property.label,
    address_line1: property.address,
    city: property.city,
    state: property.state || "FL",
    postal_code: property.postalCode,
    flood_zone: property.floodZone ?? null,
    crs_class: property.crsClass ?? null,
    access_notes: property.accessNotes ?? null,
    is_primary: true,
  });
  return created.id;
}

/** A HubSpot request, materialised so a quote or visit can hang off it. */
export async function promoteRequest(
  lead: ServiceRequest,
  clientId: string,
  propertyId?: string
): Promise<string> {
  const company = await companyId();

  const [existing] = await pg.select<{ id: string }>("requests", {
    select: "id", client_id: `eq.${clientId}`, source: `eq.${lead.source}`, external_id: `eq.${lead.id}`, limit: "1",
  });
  if (existing) return existing.id;

  const [created] = await pg.insert<{ id: string }>("requests", {
    company_id: company,
    number: await nextNumber("request"),
    client_id: clientId,
    property_id: propertyId ?? null,
    status: lead.status,
    source: lead.source,
    external_id: lead.id,
    title: lead.title,
    details: lead.details ?? null,
    estimate_low_cents: lead.estimateLowCents ?? null,
    estimate_high_cents: lead.estimateHighCents ?? null,
    created_at: lead.createdAt,
    first_response_at: lead.firstResponseAt ?? null,
  });
  return created.id;
}

/** Document numbers come from the database so two tabs cannot mint the same one. */
export async function nextNumber(docType: "request" | "quote" | "job" | "invoice"): Promise<number> {
  const company = await companyId();
  const res = await pg.rpc<number>("next_doc_number", { p_company: company, p_type: docType });
  return Number(res);
}

export { SUPABASE_LIVE };
