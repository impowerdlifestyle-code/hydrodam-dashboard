// Domain model for HydroDam Ops.
// Mirrors supabase/migrations/0001_init.sql — money is always integer cents.

export type Role = "owner" | "office" | "crew";

export type Series = "sentinel" | "onyx" | "titanium";

export type RequestStatus = "new" | "contacted" | "assessment_scheduled" | "assessed" | "converted" | "unqualified";
export type QuoteStatus = "draft" | "sent" | "viewed" | "approved" | "declined" | "expired" | "converted";
export type JobStatus = "pending" | "scheduled" | "in_progress" | "on_hold" | "completed" | "invoiced" | "closed";
export type VisitStatus = "unscheduled" | "scheduled" | "confirmed" | "en_route" | "in_progress" | "completed" | "no_show" | "cancelled";
export type VisitKind = "assessment" | "measure" | "install" | "service" | "thirty_day_check";
export type InvoiceStatus = "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "void";
export type InvoiceKind = "deposit" | "progress" | "final" | "standalone";
export type PaymentMethod = "card" | "ach" | "check" | "cash" | "wire";
export type OpeningType = "door" | "double_door" | "single_garage" | "double_garage" | "slider" | "storefront" | "window" | "custom";

export type Staff = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  color: string;
  costRateCentsPerHour: number;
  active: boolean;
};

export type Client = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type: "residential" | "commercial" | "hoa" | "property_manager";
  leadSource: string;
  /** Transactional SMS consent — the channel every send is gated on. */
  smsConsent: boolean;
  /**
   * Marketing SMS consent, a separate row on a separate channel. Kept apart
   * from `smsConsent` because a transactional yes is not permission to market:
   * reading one for the other is how a compliant ledger starts lying.
   */
  smsMarketingConsent?: boolean;
  smsConsentWording?: string;
  /** Set when they text STOP. A hard block on every send, transactional included. */
  smsOptOutAt?: string;
  tags: string[];
  createdAt: string;
  hubspotContactId?: string;
  /** HubSpot's lead status, mapped and raw. The journey reads both. */
  crmStatus?: RequestStatus;
  crmStatusLabel?: string;
  /** The associated deal, so a status change here can move the stage there. */
  hubspotDealId?: string;
  hubspotDealStage?: string;
  /**
   * Set only when HubSpot itself says money was committed: a deal that reached
   * `closedwon`, or a contact HubSpot moved to the `customer` lifecycle stage.
   *
   * Deliberately narrow. A deal sitting in `appointmentscheduled` with an
   * `amount` on it is an estimate-calculator range, not revenue, and a
   * `closedate` on such a deal is HubSpot's default projection rather than a
   * close — reading either as "paid" would put invented money on Mady's
   * dashboard. Absent means absent.
   */
  paid?: {
    via: "closed_won_deal" | "lifecycle_customer" | "lead_status_invoice_paid";
    at?: string;
    amountCents?: number;
    /** True when the amount is the midpoint of the website calculator's range, not an invoice. */
    estimated?: boolean;
  };
  /** Seeded demo row. Hidden from Clients/Requests once the CRM is connected. */
  demo?: boolean;
};

export type Property = {
  id: string;
  clientId: string;
  label: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  floodZone?: "X" | "AE" | "A" | "VE";
  crsClass?: number;
  accessNotes?: string;
};

export type Opening = {
  id: string;
  propertyId: string;
  label: string;
  type: OpeningType;
  widthIn: number;
  protectionHeightIn: number;
  surface?: string;
};

export type ServiceRequest = {
  id: string;
  number: number;
  clientId: string;
  propertyId?: string;
  status: RequestStatus;
  source: string;
  title: string;
  details?: string;
  estimateLowCents?: number;
  estimateHighCents?: number;
  assignedTo?: string;
  createdAt: string;
  firstResponseAt?: string;
  /** The id this came in under. `hsr_<contact>` for a lead promoted from HubSpot. */
  externalId?: string;
  /** Seeded demo row. Hidden from Clients/Requests once the CRM is connected. */
  demo?: boolean;
};

export type QuoteOpening = {
  id: string;
  label: string;
  type: OpeningType;
  widthIn: number;
  protectionHeightIn: number;
  quantity: number;
  series: Series;
  panelCount: number;
  postCount: number;
  centerPostRequired: boolean;
  lineTotalCents: number;
};

export type LineItem = {
  id: string;
  kind: "material" | "labor" | "fee" | "discount";
  name: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  unitCostCents: number;
  taxable: boolean;
  optional: boolean;
  selected: boolean;
};

export type Quote = {
  id: string;
  number: number;
  clientId: string;
  propertyId: string;
  requestId?: string;
  status: QuoteStatus;
  title: string;
  primarySeries: Series;
  openings: QuoteOpening[];
  lineItems: LineItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  depositPercentBps: number;
  depositDueCents: number;
  validUntil: string;
  sentAt?: string;
  viewedAt?: string;
  approvedAt?: string;
  approvedByName?: string;
  ownerId?: string;
  createdAt: string;
};

export type Job = {
  id: string;
  number: number;
  quoteId?: string;
  clientId: string;
  propertyId: string;
  status: JobStatus;
  title: string;
  instructions?: string;
  fabricationStatus: "not_started" | "cut_sheet_ready" | "in_fabrication" | "qc_passed" | "ready_for_install";
  scheduledStart?: string;
  completedAt?: string;
  warrantyEndsOn?: string;
  ownerId?: string;
  contractCents: number;
  createdAt: string;
};

export type Visit = {
  id: string;
  jobId?: string;
  requestId?: string;
  clientId: string;
  propertyId: string;
  kind: VisitKind;
  status: VisitStatus;
  title: string;
  sequence: number;
  scheduledStart: string;
  scheduledEnd: string;
  assignedTo: string[];
  routePosition?: number;
  enRouteAt?: string;
  checkedInAt?: string;
  completedAt?: string;
  crewNotes?: string;
};

export type TimeEntry = {
  id: string;
  userId: string;
  jobId?: string;
  visitId?: string;
  startedAt: string;
  endedAt?: string;
  breakMinutes: number;
  activity: "travel" | "install" | "fabrication" | "assessment" | "admin";
  costRateCentsPerHour: number;
};

export type JobMaterial = {
  id: string;
  jobId: string;
  name: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
};

export type Invoice = {
  id: string;
  number: number;
  kind: InvoiceKind;
  status: InvoiceStatus;
  clientId: string;
  jobId?: string;
  quoteId?: string;
  title: string;
  lineItems: LineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  issueDate?: string;
  dueDate?: string;
  sentAt?: string;
  paidAt?: string;
};

export type Payment = {
  id: string;
  invoiceId: string;
  clientId: string;
  method: PaymentMethod;
  status: "processing" | "succeeded" | "failed";
  amountCents: number;
  feeCents: number;
  receivedOn: string;
  expectedSettlementOn?: string;
  last4?: string;
  brand?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  clientId: string;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
  read: boolean;
  templateKey?: string;
  /** Telnyx message id, once the send is accepted. */
  providerId?: string;
  /** Last delivery receipt Telnyx sent for this message. */
  deliveryStatus?: "queued" | "sent" | "delivered" | "failed";
  deliveryError?: string;
};

export type Conversation = {
  id: string;
  clientId: string;
  channel: "sms" | "email";
  externalAddress: string;
  lastMessageAt: string;
  unreadCount: number;
  status: "open" | "closed";
};

export type ChecklistAnswer = Record<string, string>;

export type FormSubmission = {
  id: string;
  templateKey: "onboarding" | "qa_checklist";
  jobId?: string;
  visitId?: string;
  clientId: string;
  status: "draft" | "submitted";
  answers: ChecklistAnswer;
  submittedAt?: string;
  submittedByName?: string;
};

export type Automation = {
  id: string;
  name: string;
  trigger: string;
  channels: ("sms" | "email")[];
  offsetsDays: number[];
  armed: boolean;
  epochAt?: string;
  maxSendsPerRun: number;
  requiresConsent?: string;
  sentLast30d: number;
};

/** Everything the dashboard reads, in one shape. */
export type Snapshot = {
  connected: boolean;
  staff: Staff[];
  clients: Client[];
  properties: Property[];
  openings: Opening[];
  requests: ServiceRequest[];
  quotes: Quote[];
  jobs: Job[];
  visits: Visit[];
  timeEntries: TimeEntry[];
  materials: JobMaterial[];
  invoices: Invoice[];
  payments: Payment[];
  conversations: Conversation[];
  messages: Message[];
  submissions: FormSubmission[];
  automations: Automation[];
};
