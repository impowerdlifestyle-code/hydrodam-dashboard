import {
  DEPLOY_KIT_PER_OPENING_CENTS, INSTALL_PER_OPENING_CENTS, PANEL_HEIGHT_IN,
  POST_COST_EACH_CENTS, SERIES_RATE_PER_SQFT_CENTS, panelCountFor, priceOpening,
} from "@/lib/pricing";
import type {
  Automation, Client, Conversation, FormSubmission, Invoice, Job, JobMaterial, LineItem,
  Message, Opening, Payment, Property, Quote, QuoteOpening, ServiceRequest, Snapshot,
  Staff, TimeEntry, Visit,
} from "@/lib/types";

/**
 * Realistic HydroDam operating data.
 *
 * This is what the app runs on until SUPABASE_URL is set. Dates are computed
 * relative to now so the schedule always has today's work on it.
 */

const DAY = 86_400_000;

function at(dayOffset: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + dayOffset * DAY + hour * 3_600_000 + minute * 60_000).toISOString();
}

function dateOnly(dayOffset: number): string {
  return at(dayOffset, 12).slice(0, 10);
}

/** Calendar-accurate year arithmetic — 365×n drifts past leap days. */
function addYears(dayOffset: number, years: number): string {
  const d = new Date(at(dayOffset, 12));
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- staff

const staff: Staff[] = [
  { id: "u_mady", name: "Madeline Scribner", email: "mady@thehydrodam.com", phone: "+17275550110", role: "owner", color: "#1f8ab3", costRateCentsPerHour: 0, active: true },
  { id: "u_emma", name: "Emma Scribner", email: "emma.scribner@thehydrodam.com", phone: "+17275550111", role: "office", color: "#7eabb9", costRateCentsPerHour: 3200, active: true },
  { id: "u_luis", name: "Luis Ortega", email: "luis@thehydrodam.com", phone: "+17275550112", role: "crew", color: "#cc551e", costRateCentsPerHour: 4200, active: true },
  { id: "u_dean", name: "Dean Whitaker", email: "dean@thehydrodam.com", phone: "+17275550113", role: "crew", color: "#bf7c58", costRateCentsPerHour: 3800, active: true },
  { id: "u_tj", name: "TJ Moreau", email: "tj@thehydrodam.com", phone: "+17275550114", role: "crew", color: "#2fbf71", costRateCentsPerHour: 3500, active: true },
];

// ---------------------------------------------------------------- clients

type ClientSeed = {
  id: string; name: string; email: string; phone: string;
  type: Client["type"]; source: string; consent: boolean;
  address: string; city: string; zip: string;
  zone: Property["floodZone"]; crs?: number; tags?: string[]; days: number;
};

const CLIENT_SEEDS: ClientSeed[] = [
  { id: "c_picun", name: "Tony Picun", email: "tpicun@gmail.com", phone: "+17275550231", type: "commercial", source: "Referral", consent: true, address: "480 Gulf Blvd", city: "Indian Rocks Beach", zip: "33785", zone: "VE", crs: 5, tags: ["High value", "Waterfront"], days: -96 },
  { id: "c_alvarez", name: "Renata Alvarez", email: "renata.alvarez@outlook.com", phone: "+17275550244", type: "residential", source: "Google", consent: true, address: "2214 Shore Acres Blvd NE", city: "St. Petersburg", zip: "33703", zone: "AE", crs: 5, tags: ["Helene damage"], days: -74 },
  { id: "c_bramwell", name: "Gordon Bramwell", email: "gbramwell@icloud.com", phone: "+17275550258", type: "residential", source: "Website form", consent: true, address: "1119 Snell Isle Blvd NE", city: "St. Petersburg", zip: "33704", zone: "AE", crs: 5, days: -61 },
  { id: "c_harborview", name: "Harborview Condominium Assoc.", email: "manager@harborviewcondos.com", phone: "+17275550266", type: "hoa", source: "Referral", consent: false, address: "700 Island Way", city: "Clearwater Beach", zip: "33767", zone: "VE", crs: 5, tags: ["HOA", "Multi-unit"], days: -55 },
  { id: "c_delgado", name: "Marisol Delgado", email: "m.delgado@gmail.com", phone: "+17275550277", type: "residential", source: "Estimate calculator", consent: true, address: "8412 Bayview Dr", city: "Seminole", zip: "33776", zone: "AE", crs: 8, days: -43 },
  { id: "c_kwan", name: "Peter Kwan", email: "pkwan@bayvistadental.com", phone: "+17275550288", type: "commercial", source: "Google", consent: true, address: "3300 4th St N", city: "St. Petersburg", zip: "33704", zone: "X", crs: 5, tags: ["Storefront"], days: -38 },
  { id: "c_oleary", name: "Bridget O'Leary", email: "bridget.oleary@yahoo.com", phone: "+17275550299", type: "residential", source: "Facebook", consent: true, address: "515 Bayway Blvd", city: "Clearwater Beach", zip: "33767", zone: "VE", crs: 5, days: -29 },
  { id: "c_navarro", name: "Elias Navarro", email: "enavarro@protonmail.com", phone: "+17275550303", type: "residential", source: "Website form", consent: false, address: "6015 Gulfport Blvd S", city: "Gulfport", zip: "33707", zone: "AE", crs: 6, days: -21 },
  { id: "c_reddick", name: "Charlene Reddick", email: "creddick@gmail.com", phone: "+17275550314", type: "residential", source: "Home show", consent: true, address: "1440 Tarpon Woods Blvd", city: "Palm Harbor", zip: "34685", zone: "X", crs: 5, days: -14 },
  { id: "c_fontaine", name: "Adrien Fontaine", email: "adrien@fontainegroup.co", phone: "+17275550325", type: "commercial", source: "Referral", consent: true, address: "201 Central Ave", city: "St. Petersburg", zip: "33701", zone: "AE", crs: 5, tags: ["Storefront"], days: -9 },
  { id: "c_whitfield", name: "Dana Whitfield", email: "dwhitfield@gmail.com", phone: "+17275550336", type: "residential", source: "Google", consent: true, address: "3721 Belle Vista Dr E", city: "St. Pete Beach", zip: "33706", zone: "VE", crs: 5, days: -5 },
  { id: "c_sandoval", name: "Rafael Sandoval", email: "rsandoval@gmail.com", phone: "+17275550347", type: "residential", source: "Estimate calculator", consent: false, address: "9020 Blind Pass Rd", city: "St. Pete Beach", zip: "33706", zone: "AE", crs: 5, days: -2 },
  { id: "c_mercer", name: "Yvonne Mercer", email: "ymercer@bellsouth.net", phone: "+17275550358", type: "residential", source: "Website form", consent: true, address: "127 Driftwood Ln", city: "Largo", zip: "33770", zone: "AE", crs: 6, days: -1 },
];

const CONSENT_WORDING =
  "I agree to receive text messages from HydroDam about my estimate and installation. Message and data rates may apply. Reply STOP to opt out.";

const clients: Client[] = CLIENT_SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  phone: s.phone,
  type: s.type,
  leadSource: s.source,
  smsConsent: s.consent,
  smsConsentWording: s.consent ? CONSENT_WORDING : undefined,
  tags: s.tags ?? [],
  createdAt: at(s.days, 10),
  hubspotContactId: `hs_${s.id.slice(2)}`,
}));

const properties: Property[] = CLIENT_SEEDS.map((s) => ({
  id: `p_${s.id.slice(2)}`,
  clientId: s.id,
  label: s.type === "residential" ? "Primary residence" : "Business premises",
  address: s.address,
  city: s.city,
  state: "FL",
  postalCode: s.zip,
  floodZone: s.zone,
  crsClass: s.crs,
  accessNotes:
    s.id === "c_harborview" ? "Check in with front desk. Loading dock on the north side."
    : s.id === "c_oleary" ? "Gate code 4482. Two dogs in the yard."
    : undefined,
}));

// ---------------------------------------------------------------- openings

type OpeningSeed = [clientId: string, label: string, type: Opening["type"], w: number, h: number];

const OPENING_SEEDS: OpeningSeed[] = [
  ["c_picun", "Main entry double door", "double_door", 72, 48],
  ["c_picun", "Rear service door", "door", 36, 48],
  ["c_picun", "Loading bay", "double_garage", 192, 42],
  ["c_picun", "Pool deck slider", "slider", 96, 42],
  ["c_alvarez", "Front door", "door", 38, 36],
  ["c_alvarez", "Two-car garage", "double_garage", 192, 36],
  ["c_alvarez", "Lanai slider", "slider", 144, 36],
  ["c_bramwell", "Front entry", "door", 42, 42],
  ["c_bramwell", "Garage", "double_garage", 180, 42],
  ["c_harborview", "Lobby entrance", "storefront", 120, 54],
  ["c_harborview", "Garage ramp", "double_garage", 216, 54],
  ["c_harborview", "Pool gate", "door", 40, 54],
  ["c_delgado", "Front door", "door", 36, 36],
  ["c_delgado", "Single garage", "single_garage", 108, 36],
  ["c_kwan", "Storefront entry", "storefront", 84, 30],
  ["c_kwan", "Side service door", "door", 36, 30],
  ["c_oleary", "Front entry", "door", 40, 48],
  ["c_oleary", "Garage", "double_garage", 192, 48],
  ["c_oleary", "Rear slider", "slider", 120, 48],
  ["c_navarro", "Front door", "door", 36, 36],
  ["c_reddick", "Front entry", "door", 38, 30],
  ["c_fontaine", "Storefront", "storefront", 144, 42],
  ["c_fontaine", "Alley door", "door", 36, 42],
  ["c_whitfield", "Front door", "door", 40, 42],
  ["c_whitfield", "Two-car garage", "double_garage", 192, 42],
];

const openings: Opening[] = OPENING_SEEDS.map(([cid, label, type, w, h], i) => ({
  id: `o_${i + 1}`,
  propertyId: `p_${cid.slice(2)}`,
  label,
  type,
  widthIn: w,
  protectionHeightIn: h,
  surface: h > 44 ? "Concrete" : "Pavers",
}));

// ---------------------------------------------------------------- pricing


function buildQuoteOpening(o: Opening, series: Quote["primarySeries"], idx: number): QuoteOpening {
  const posts = o.widthIn > 108 ? 3 : 2;
  return {
    id: `qo_${o.id}_${idx}`,
    label: o.label,
    type: o.type,
    widthIn: o.widthIn,
    protectionHeightIn: o.protectionHeightIn,
    quantity: 1,
    series,
    panelCount: panelCountFor(o.protectionHeightIn),
    postCount: posts,
    centerPostRequired: o.widthIn > 108,
    lineTotalCents: priceOpening(o.widthIn, o.protectionHeightIn, series, 1),
  };
}

// ---------------------------------------------------------------- requests

const requests: ServiceRequest[] = [
  { id: "r_1", number: 1041, clientId: "c_mercer", status: "new", source: "Website form", title: "Flood barrier assessment — Largo", details: "Two openings, front door and garage. Took water in Helene.", estimateLowCents: 640000, estimateHighCents: 848000, createdAt: at(-1, 8, 12) },
  { id: "r_2", number: 1040, clientId: "c_sandoval", status: "new", source: "Estimate calculator", title: "Flood barrier assessment — St. Pete Beach", details: "Wants pricing on a single garage plus front entry.", estimateLowCents: 512000, estimateHighCents: 690000, createdAt: at(-2, 15, 40) },
  { id: "r_3", number: 1039, clientId: "c_whitfield", propertyId: "p_whitfield", status: "assessment_scheduled", source: "Google", title: "Flood barrier assessment — St. Pete Beach", details: "VE zone, wants the heavier series.", estimateLowCents: 980000, estimateHighCents: 1320000, assignedTo: "u_emma", createdAt: at(-5, 11, 5), firstResponseAt: at(-5, 11, 8) },
  { id: "r_4", number: 1038, clientId: "c_fontaine", propertyId: "p_fontaine", status: "assessed", source: "Referral", title: "Storefront protection — Central Ave", details: "Retail frontage, wants minimal visual impact.", assignedTo: "u_mady", createdAt: at(-9, 9, 30), firstResponseAt: at(-9, 9, 32) },
  { id: "r_5", number: 1037, clientId: "c_reddick", status: "contacted", source: "Home show", title: "Flood barrier enquiry — Palm Harbor", details: "Zone X, mostly concerned about driving rain.", assignedTo: "u_emma", createdAt: at(-14, 13, 15), firstResponseAt: at(-14, 14, 2) },
  { id: "r_6", number: 1036, clientId: "c_navarro", status: "unqualified", source: "Website form", title: "Flood barrier enquiry — Gulfport", details: "Renting; landlord not interested.", createdAt: at(-21, 16, 0), firstResponseAt: at(-21, 16, 3) },
];

// ---------------------------------------------------------------- quotes

function lineItemsFor(qo: QuoteOpening[], series: Quote["primarySeries"]): LineItem[] {
  const items: LineItem[] = qo.map((o) => ({
    id: `li_${o.id}`,
    kind: "material" as const,
    name: `${series[0].toUpperCase()}${series.slice(1)} Series barrier — ${o.label}`,
    quantity: o.quantity,
    unit: "each",
    unitPriceCents: o.lineTotalCents,
    unitCostCents: Math.round(o.lineTotalCents * 0.42),
    taxable: true,
    optional: false,
    selected: true,
  }));
  items.push({
    id: `li_install_${qo[0]?.id ?? "x"}`,
    kind: "labor",
    name: "Installation labor",
    quantity: qo.length,
    unit: "opening",
    unitPriceCents: INSTALL_PER_OPENING_CENTS,
    unitCostCents: 9000,
    taxable: false,
    optional: false,
    selected: true,
  });
  return items;
}

function totals(items: LineItem[], discountCents = 0) {
  const active = items.filter((i) => i.selected);
  const subtotal = active.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  const taxableBase = active.filter((i) => i.taxable).reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
  const tax = 0; // lump-sum real property improvement — see migration notes
  return { subtotalCents: subtotal, taxableBase, taxCents: tax, totalCents: subtotal - discountCents + tax };
}

type QuoteSeed = {
  id: string; number: number; clientId: string; status: Quote["status"];
  series: Quote["primarySeries"]; days: number; discount?: number; requestId?: string;
};

const QUOTE_SEEDS: QuoteSeed[] = [
  { id: "q_picun", number: 2094, clientId: "c_picun", status: "converted", series: "onyx", days: -88 },
  { id: "q_alvarez", number: 2096, clientId: "c_alvarez", status: "converted", series: "sentinel", days: -68 },
  { id: "q_bramwell", number: 2099, clientId: "c_bramwell", status: "converted", series: "onyx", days: -54 },
  { id: "q_harborview", number: 2103, clientId: "c_harborview", status: "approved", series: "onyx", days: -9, discount: 150000 },
  { id: "q_delgado", number: 2105, clientId: "c_delgado", status: "converted", series: "sentinel", days: -37 },
  { id: "q_kwan", number: 2108, clientId: "c_kwan", status: "sent", series: "sentinel", days: -11 },
  { id: "q_oleary", number: 2110, clientId: "c_oleary", status: "viewed", series: "onyx", days: -7 },
  { id: "q_fontaine", number: 2112, clientId: "c_fontaine", status: "draft", series: "titanium", days: -3, requestId: "r_4" },
  { id: "q_navarro", number: 2101, clientId: "c_navarro", status: "declined", series: "sentinel", days: -24 },
  { id: "q_reddick", number: 2107, clientId: "c_reddick", status: "expired", series: "sentinel", days: -46 },
];

const quotes: Quote[] = QUOTE_SEEDS.map((s) => {
  const propertyId = `p_${s.clientId.slice(2)}`;
  const qo = openings
    .filter((o) => o.propertyId === propertyId)
    .map((o, idx) => buildQuoteOpening(o, s.series, idx));
  const items = lineItemsFor(qo, s.series);
  const t = totals(items, s.discount ?? 0);
  const approved = s.status === "approved" || s.status === "converted";
  return {
    id: s.id,
    number: s.number,
    clientId: s.clientId,
    propertyId,
    requestId: s.requestId,
    status: s.status,
    title: `HydroDam ${s.series[0].toUpperCase()}${s.series.slice(1)} Series flood barrier system`,
    primarySeries: s.series,
    openings: qo,
    lineItems: items,
    subtotalCents: t.subtotalCents,
    discountCents: s.discount ?? 0,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    depositPercentBps: 5000,
    depositDueCents: Math.round(t.totalCents / 2),
    validUntil: dateOnly(s.days + 30),
    sentAt: s.status === "draft" ? undefined : at(s.days, 14),
    viewedAt: s.status === "draft" || s.status === "sent" ? undefined : at(s.days + 1, 9),
    approvedAt: approved ? at(s.days + 3, 16) : undefined,
    approvedByName: approved ? clients.find((c) => c.id === s.clientId)?.name : undefined,
    ownerId: "u_mady",
    createdAt: at(s.days, 11),
  };
});

// ---------------------------------------------------------------- jobs

type JobSeed = {
  id: string; number: number; quoteId: string; status: Job["status"];
  fab: Job["fabricationStatus"]; startDays: number;
};

const JOB_SEEDS: JobSeed[] = [
  { id: "j_picun", number: 318, quoteId: "q_picun", status: "closed", fab: "ready_for_install", startDays: -72 },
  { id: "j_alvarez", number: 322, quoteId: "q_alvarez", status: "invoiced", fab: "ready_for_install", startDays: -48 },
  { id: "j_bramwell", number: 325, quoteId: "q_bramwell", status: "completed", fab: "ready_for_install", startDays: -12 },
  { id: "j_delgado", number: 327, quoteId: "q_delgado", status: "in_progress", fab: "ready_for_install", startDays: 0 },
  { id: "j_harborview", number: 329, quoteId: "q_harborview", status: "scheduled", fab: "in_fabrication", startDays: 4 },
];

const jobs: Job[] = JOB_SEEDS.map((s) => {
  const q = quotes.find((x) => x.id === s.quoteId)!;
  const done = s.status === "completed" || s.status === "invoiced" || s.status === "closed";
  return {
    id: s.id,
    number: s.number,
    quoteId: q.id,
    clientId: q.clientId,
    propertyId: q.propertyId,
    status: s.status,
    title: q.title,
    instructions:
      s.id === "j_harborview" ? "Association requires work between 9am and 4pm only. Coordinate with front desk."
      : s.id === "j_delgado" ? "Homeowner works from home — keep the front entry passable through the day."
      : undefined,
    fabricationStatus: s.fab,
    scheduledStart: at(s.startDays, 8),
    completedAt: done ? at(s.startDays + 1, 16) : undefined,
    warrantyEndsOn: done ? addYears(s.startDays + 1, 5) : undefined,
    ownerId: "u_mady",
    contractCents: q.totalCents,
    createdAt: at(s.startDays - 10, 10),
  };
});

// ---------------------------------------------------------------- visits

const visits: Visit[] = [
  // today
  { id: "v_1", jobId: "j_delgado", clientId: "c_delgado", propertyId: "p_delgado", kind: "install", status: "in_progress", title: "Install — day 1 of 1", sequence: 1, scheduledStart: at(0, 8), scheduledEnd: at(0, 14), assignedTo: ["u_luis", "u_tj"], routePosition: 1, enRouteAt: at(0, 7, 35), checkedInAt: at(0, 8, 6) },
  { id: "v_2", requestId: "r_3", clientId: "c_whitfield", propertyId: "p_whitfield", kind: "assessment", status: "scheduled", title: "On-site assessment", sequence: 1, scheduledStart: at(0, 13), scheduledEnd: at(0, 14, 30), assignedTo: ["u_dean"], routePosition: 1 },
  { id: "v_3", jobId: "j_bramwell", clientId: "c_bramwell", propertyId: "p_bramwell", kind: "thirty_day_check", status: "scheduled", title: "30-day functionality check", sequence: 3, scheduledStart: at(0, 15, 30), scheduledEnd: at(0, 16, 30), assignedTo: ["u_dean"], routePosition: 2 },
  // tomorrow
  { id: "v_4", jobId: "j_delgado", clientId: "c_delgado", propertyId: "p_delgado", kind: "service", status: "scheduled", title: "Punch list + handover", sequence: 2, scheduledStart: at(1, 9), scheduledEnd: at(1, 11), assignedTo: ["u_luis"], routePosition: 1 },
  { id: "v_5", clientId: "c_oleary", propertyId: "p_oleary", kind: "measure", status: "scheduled", title: "Final measure", sequence: 1, scheduledStart: at(1, 13), scheduledEnd: at(1, 15), assignedTo: ["u_tj"], routePosition: 1 },
  // this week
  { id: "v_6", jobId: "j_harborview", clientId: "c_harborview", propertyId: "p_harborview", kind: "install", status: "scheduled", title: "Install — day 1 of 2", sequence: 1, scheduledStart: at(4, 9), scheduledEnd: at(4, 16), assignedTo: ["u_luis", "u_dean", "u_tj"], routePosition: 1 },
  { id: "v_7", jobId: "j_harborview", clientId: "c_harborview", propertyId: "p_harborview", kind: "install", status: "scheduled", title: "Install — day 2 of 2", sequence: 2, scheduledStart: at(5, 9), scheduledEnd: at(5, 16), assignedTo: ["u_luis", "u_dean", "u_tj"], routePosition: 1 },
  { id: "v_8", clientId: "c_kwan", propertyId: "p_kwan", kind: "assessment", status: "unscheduled", title: "On-site assessment", sequence: 1, scheduledStart: at(2, 10), scheduledEnd: at(2, 11, 30), assignedTo: [] },
  // past
  { id: "v_9", jobId: "j_bramwell", clientId: "c_bramwell", propertyId: "p_bramwell", kind: "install", status: "completed", title: "Install — day 1 of 1", sequence: 1, scheduledStart: at(-12, 8), scheduledEnd: at(-12, 15), assignedTo: ["u_luis", "u_dean"], completedAt: at(-12, 15, 20), crewNotes: "Garage track needed shimming, 20 min extra." },
  { id: "v_10", jobId: "j_alvarez", clientId: "c_alvarez", propertyId: "p_alvarez", kind: "install", status: "completed", title: "Install — day 1 of 1", sequence: 1, scheduledStart: at(-48, 8), scheduledEnd: at(-48, 14), assignedTo: ["u_luis", "u_tj"], completedAt: at(-48, 14, 10) },
];

// ---------------------------------------------------------------- time + materials

const timeEntries: TimeEntry[] = [
  { id: "t_1", userId: "u_luis", jobId: "j_delgado", visitId: "v_1", startedAt: at(0, 7, 35), breakMinutes: 0, activity: "travel", costRateCentsPerHour: 4200 },
  { id: "t_2", userId: "u_tj", jobId: "j_delgado", visitId: "v_1", startedAt: at(0, 8, 6), breakMinutes: 0, activity: "install", costRateCentsPerHour: 3500 },
  { id: "t_3", userId: "u_luis", jobId: "j_bramwell", visitId: "v_9", startedAt: at(-12, 7, 30), endedAt: at(-12, 15, 30), breakMinutes: 30, activity: "install", costRateCentsPerHour: 4200 },
  { id: "t_4", userId: "u_dean", jobId: "j_bramwell", visitId: "v_9", startedAt: at(-12, 7, 45), endedAt: at(-12, 15, 30), breakMinutes: 30, activity: "install", costRateCentsPerHour: 3800 },
  { id: "t_5", userId: "u_luis", jobId: "j_alvarez", visitId: "v_10", startedAt: at(-48, 7, 30), endedAt: at(-48, 14, 30), breakMinutes: 30, activity: "install", costRateCentsPerHour: 4200 },
  { id: "t_6", userId: "u_tj", jobId: "j_alvarez", visitId: "v_10", startedAt: at(-48, 7, 45), endedAt: at(-48, 14, 30), breakMinutes: 30, activity: "install", costRateCentsPerHour: 3500 },
  { id: "t_7", userId: "u_dean", jobId: "j_bramwell", startedAt: at(-14, 9), endedAt: at(-14, 13), breakMinutes: 0, activity: "fabrication", costRateCentsPerHour: 3800 },
];

const materials: JobMaterial[] = [
  { id: "m_1", jobId: "j_bramwell", name: "Onyx plank stock 6063-T6", quantity: 18, unit: "plank", unitCostCents: 8600 },
  { id: "m_2", jobId: "j_bramwell", name: "U-channel post, fabricated", quantity: 4, unit: "each", unitCostCents: 9800 },
  { id: "m_3", jobId: "j_bramwell", name: "EPDM seal kit", quantity: 2, unit: "kit", unitCostCents: 4200 },
  { id: "m_4", jobId: "j_alvarez", name: "Sentinel plank stock 6063-T6", quantity: 21, unit: "plank", unitCostCents: 6900 },
  { id: "m_5", jobId: "j_alvarez", name: "U-channel post, fabricated", quantity: 6, unit: "each", unitCostCents: 9800 },
  { id: "m_6", jobId: "j_delgado", name: "Sentinel plank stock 6063-T6", quantity: 12, unit: "plank", unitCostCents: 6900 },
];

// ---------------------------------------------------------------- invoices + payments

type InvoiceSeed = {
  id: string; number: number; jobId: string; kind: Invoice["kind"];
  status: Invoice["status"]; pct: number; issuedDays: number; dueDays: number;
};

const INVOICE_SEEDS: InvoiceSeed[] = [
  { id: "i_picun_d", number: 4011, jobId: "j_picun", kind: "deposit", status: "paid", pct: 0.5, issuedDays: -85, dueDays: -78 },
  { id: "i_picun_f", number: 4019, jobId: "j_picun", kind: "final", status: "paid", pct: 0.5, issuedDays: -71, dueDays: -64 },
  { id: "i_alvarez_d", number: 4023, jobId: "j_alvarez", kind: "deposit", status: "paid", pct: 0.5, issuedDays: -65, dueDays: -58 },
  { id: "i_alvarez_f", number: 4031, jobId: "j_alvarez", kind: "final", status: "partially_paid", pct: 0.5, issuedDays: -47, dueDays: -40 },
  { id: "i_bramwell_d", number: 4036, jobId: "j_bramwell", kind: "deposit", status: "paid", pct: 0.5, issuedDays: -51, dueDays: -44 },
  { id: "i_bramwell_f", number: 4044, jobId: "j_bramwell", kind: "final", status: "sent", pct: 0.5, issuedDays: -11, dueDays: -4 },
  { id: "i_delgado_d", number: 4040, jobId: "j_delgado", kind: "deposit", status: "paid", pct: 0.5, issuedDays: -34, dueDays: -27 },
  { id: "i_harborview_d", number: 4047, jobId: "j_harborview", kind: "deposit", status: "sent", pct: 0.5, issuedDays: -17, dueDays: 3 },
];

const invoices: Invoice[] = INVOICE_SEEDS.map((s) => {
  const job = jobs.find((j) => j.id === s.jobId)!;
  const amount = Math.round(job.contractCents * s.pct);
  const item: LineItem = {
    id: `ili_${s.id}`,
    kind: "material",
    name: s.kind === "deposit" ? "Deposit — 50% of contract" : s.kind === "final" ? "Balance due on completion" : "Progress payment",
    quantity: 1,
    unit: "each",
    unitPriceCents: amount,
    unitCostCents: 0,
    taxable: false,
    optional: false,
    selected: true,
  };
  const paid = s.status === "paid" ? amount : s.status === "partially_paid" ? Math.round(amount * 0.6) : 0;
  return {
    id: s.id,
    number: s.number,
    kind: s.kind,
    status: s.status,
    clientId: job.clientId,
    jobId: job.id,
    quoteId: job.quoteId,
    title: `${job.title} — ${s.kind === "deposit" ? "deposit" : s.kind === "final" ? "balance" : "progress"}`,
    lineItems: [item],
    subtotalCents: amount,
    taxCents: 0,
    totalCents: amount,
    amountPaidCents: paid,
    issueDate: dateOnly(s.issuedDays),
    dueDate: dateOnly(s.dueDays),
    sentAt: at(s.issuedDays, 10),
    paidAt: s.status === "paid" ? at(s.dueDays - 2, 11) : undefined,
  };
});

const payments: Payment[] = invoices
  .filter((i) => i.amountPaidCents > 0)
  .map((i, idx) => ({
    id: `pay_${idx + 1}`,
    invoiceId: i.id,
    clientId: i.clientId,
    method: i.totalCents > 800000 ? "ach" : idx % 3 === 0 ? "check" : "card",
    status: "succeeded" as const,
    amountCents: i.amountPaidCents,
    feeCents: i.totalCents > 800000 ? 500 : Math.round(i.amountPaidCents * 0.029) + 30,
    receivedOn: i.paidAt?.slice(0, 10) ?? dateOnly(-3),
    last4: idx % 3 === 0 ? undefined : "4242",
    brand: idx % 3 === 0 ? undefined : "Visa",
  }));

// ---------------------------------------------------------------- comms

const conversations: Conversation[] = [
  { id: "cv_1", clientId: "c_delgado", channel: "sms", externalAddress: "+17275550277", lastMessageAt: at(0, 8, 12), unreadCount: 1, status: "open" },
  { id: "cv_2", clientId: "c_oleary", channel: "sms", externalAddress: "+17275550299", lastMessageAt: at(-1, 17, 4), unreadCount: 2, status: "open" },
  { id: "cv_3", clientId: "c_harborview", channel: "email", externalAddress: "manager@harborviewcondos.com", lastMessageAt: at(-2, 10, 30), unreadCount: 0, status: "open" },
  { id: "cv_4", clientId: "c_kwan", channel: "sms", externalAddress: "+17275550288", lastMessageAt: at(-4, 12, 15), unreadCount: 0, status: "open" },
  { id: "cv_5", clientId: "c_mercer", channel: "sms", externalAddress: "+17275550358", lastMessageAt: at(-1, 8, 20), unreadCount: 0, status: "open" },
];

const messages: Message[] = [
  { id: "ms_1", conversationId: "cv_1", clientId: "c_delgado", channel: "sms", direction: "outbound", body: "Good morning Marisol — Luis and TJ are on their way, ETA about 20 minutes. — HydroDam", createdAt: at(0, 7, 35), read: true, templateKey: "on_my_way" },
  { id: "ms_2", conversationId: "cv_1", clientId: "c_delgado", channel: "sms", direction: "inbound", body: "Perfect, side gate is unlocked for them. Thank you!", createdAt: at(0, 8, 12), read: false },
  { id: "ms_3", conversationId: "cv_2", clientId: "c_oleary", channel: "sms", direction: "outbound", body: "Hi Bridget, your quote #2110 is ready to view: https://ops.thehydrodam.com/l/8kd2m", createdAt: at(-7, 14, 2), read: true, templateKey: "quote_sent" },
  { id: "ms_4", conversationId: "cv_2", clientId: "c_oleary", channel: "sms", direction: "inbound", body: "Looked it over. Can we do the garage in the heavier series and leave the slider for next year?", createdAt: at(-1, 16, 58), read: false },
  { id: "ms_5", conversationId: "cv_2", clientId: "c_oleary", channel: "sms", direction: "inbound", body: "Also what's the lead time if we sign this week?", createdAt: at(-1, 17, 4), read: false },
  { id: "ms_6", conversationId: "cv_3", clientId: "c_harborview", channel: "email", direction: "inbound", body: "The board approved the proposal at Tuesday's meeting. Please send the deposit invoice to accounts@harborviewcondos.com.", createdAt: at(-2, 10, 30), read: true },
  { id: "ms_7", conversationId: "cv_4", clientId: "c_kwan", channel: "sms", direction: "outbound", body: "Hi Peter — following up on quote #2108. Happy to walk through the storefront options whenever suits. — Emma, HydroDam", createdAt: at(-4, 12, 15), read: true, templateKey: "quote_followup" },
  { id: "ms_8", conversationId: "cv_5", clientId: "c_mercer", channel: "sms", direction: "outbound", body: "Thanks for reaching out to HydroDam, Yvonne. Emma will call you within the hour to book your free assessment.", createdAt: at(-1, 8, 20), read: true, templateKey: "speed_to_lead" },
];

// ---------------------------------------------------------------- submissions

const submissions: FormSubmission[] = [
  {
    id: "fs_1", templateKey: "qa_checklist", jobId: "j_bramwell", visitId: "v_9", clientId: "c_bramwell",
    status: "submitted", submittedAt: at(-12, 15, 18), submittedByName: "Luis Ortega",
    answers: {
      parts_match_order: "Pass", seals_intact: "Pass", hardware_complete: "Pass", finish_ok: "Pass",
      opening_measured: "Pass", measured_width: "180", measured_height: "42",
      centre_post: "Required and fitted", surface_prepared: "Pass", utilities_checked: "Pass",
      posts_plumb: "Pass", anchors_torqued: "Pass", planks_seat: "Pass", locking_plate: "Pass",
      seal_contact: "Pass", debris_cleared: "Pass",
      demo_given: "Pass", customer_deployed: "Pass", storage_agreed: "Pass", docs_left: "Pass",
      thirty_day_explained: "Pass", photos_taken: "Pass",
      issues: "Garage track needed shimming, resolved on site.", installer: "Luis Ortega",
    },
  },
  {
    id: "fs_2", templateKey: "onboarding", clientId: "c_bramwell", jobId: "j_bramwell",
    status: "submitted", submittedAt: at(-51, 19, 22), submittedByName: "Gordon Bramwell",
    answers: {
      property_address: "1119 Snell Isle Blvd NE, St. Petersburg FL 33704",
      property_type: "Single-family home", year_built: "1968",
      prior_flooding: "Yes — about 8 inches came in through the garage in Helene",
      openings: "Front entry and the two-car garage",
      surface: "Concrete", surface_level: "Slight slope or dip",
      deployer: "I will", storage: "Garage wall rack",
      heard_about: "A neighbour or friend",
    },
  },
];

// ---------------------------------------------------------------- automations

const automations: Automation[] = [
  { id: "a_speed", name: "Speed to lead", trigger: "request.created", channels: ["sms", "email"], offsetsDays: [0], armed: true, epochAt: at(-30), maxSendsPerRun: 200, sentLast30d: 41 },
  { id: "a_reminder", name: "Appointment reminder — 24h", trigger: "visit.scheduled", channels: ["sms", "email"], offsetsDays: [-1], armed: true, epochAt: at(-30), maxSendsPerRun: 200, sentLast30d: 28 },
  { id: "a_omw", name: "On my way", trigger: "visit.en_route", channels: ["sms"], offsetsDays: [0], armed: true, epochAt: at(-30), maxSendsPerRun: 200, sentLast30d: 19 },
  { id: "a_quote", name: "Quote follow-up", trigger: "quote.sent", channels: ["email", "sms"], offsetsDays: [3, 7, 14], armed: true, epochAt: at(-30), maxSendsPerRun: 25, sentLast30d: 12 },
  { id: "a_invoice", name: "Invoice reminders", trigger: "invoice.sent", channels: ["email", "sms"], offsetsDays: [-3, 0, 7, 14, 30], armed: true, epochAt: at(-30), maxSendsPerRun: 100, sentLast30d: 9 },
  { id: "a_review", name: "Review request", trigger: "job.closed", channels: ["email", "sms"], offsetsDays: [7], armed: true, epochAt: at(-30), maxSendsPerRun: 25, sentLast30d: 4 },
  { id: "a_nurture", name: "Dormant lead nurture", trigger: "lead.status_changed", channels: ["email"], offsetsDays: [14, 28, 42, 56], armed: false, maxSendsPerRun: 25, requiresConsent: "email_marketing", sentLast30d: 0 },
  { id: "a_storm", name: "Storm-watch surge alert", trigger: "manual", channels: ["email", "sms"], offsetsDays: [0], armed: false, maxSendsPerRun: 25, requiresConsent: "sms_marketing", sentLast30d: 0 },
];

// ---------------------------------------------------------------- export

export function buildSeed(): Snapshot {
  return {
    connected: false,
    staff, clients, properties, openings, requests, quotes, jobs, visits,
    timeEntries, materials, invoices, payments, conversations, messages,
    submissions, automations,
  };
}
