// HubSpot CRM data layer. Uses a Private App token (HUBSPOT_TOKEN).
// Falls back to realistic mock data when no token is set, so the dashboard is
// fully populated for review before HubSpot is connected.

const BASE = "https://api.hubapi.com";
const token = () => process.env.HUBSPOT_TOKEN;

export type Deal = { id: string; name: string; amount: number; stage: string; closeDate?: string };
export type Contact = { id: string; name: string; email?: string; phone?: string; stage?: string; created?: string };
export type Task = { id: string; title: string; due?: string; status: string };

export type CrmSummary = {
  connected: boolean;
  deals: Deal[];
  contacts: Contact[];
  tasks: Task[];
  metrics: {
    openDeals: number;
    openValue: number;
    wonValue: number;
    newContacts30d: number;
    closeRate: number;
  };
  pipeline: { stage: string; count: number; value: number }[];
};

async function hs<T>(path: string): Promise<T | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const STAGE_LABEL: Record<string, string> = {
  appointmentscheduled: "Assessment booked",
  qualifiedtobuy: "Qualified",
  presentationscheduled: "Quoted",
  decisionmakerboughtin: "Negotiation",
  contractsent: "Contract sent",
  closedwon: "Won",
  closedlost: "Lost",
};
const labelStage = (s: string) => STAGE_LABEL[s] ?? s.replace(/([a-z])([A-Z])/g, "$1 $2");

export async function getCrmSummary(): Promise<CrmSummary> {
  const dealsRaw = await hs<{ results: { id: string; properties: Record<string, string> }[] }>(
    "/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate",
  );
  const contactsRaw = await hs<{ results: { id: string; properties: Record<string, string> }[] }>(
    "/crm/v3/objects/contacts?limit=20&properties=firstname,lastname,email,phone,lifecyclestage,createdate",
  );

  if (!dealsRaw && !contactsRaw) return mockSummary();

  const deals: Deal[] = (dealsRaw?.results ?? []).map((d) => ({
    id: d.id,
    name: d.properties.dealname ?? "Untitled deal",
    amount: Number(d.properties.amount ?? 0),
    stage: labelStage(d.properties.dealstage ?? ""),
    closeDate: d.properties.closedate,
  }));
  const contacts: Contact[] = (contactsRaw?.results ?? []).map((c) => ({
    id: c.id,
    name: `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim() || (c.properties.email ?? "Unknown"),
    email: c.properties.email,
    phone: c.properties.phone,
    stage: c.properties.lifecyclestage,
    created: c.properties.createdate,
  }));

  return { connected: true, deals, contacts, tasks: [], ...derive(deals, contacts) };
}

function derive(deals: Deal[], contacts: Contact[]) {
  const open = deals.filter((d) => !/won|lost/i.test(d.stage));
  const won = deals.filter((d) => /won/i.test(d.stage));
  const lost = deals.filter((d) => /lost/i.test(d.stage));
  const byStage = new Map<string, { count: number; value: number }>();
  for (const d of open) {
    const cur = byStage.get(d.stage) ?? { count: 0, value: 0 };
    byStage.set(d.stage, { count: cur.count + 1, value: cur.value + d.amount });
  }
  const cutoff = Date.now() - 30 * 864e5;
  const new30 = contacts.filter((c) => c.created && Date.parse(c.created) > cutoff).length;
  return {
    metrics: {
      openDeals: open.length,
      openValue: open.reduce((s, d) => s + d.amount, 0),
      wonValue: won.reduce((s, d) => s + d.amount, 0),
      newContacts30d: new30,
      closeRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    },
    pipeline: [...byStage.entries()].map(([stage, v]) => ({ stage, ...v })),
  };
}

function mockSummary(): CrmSummary {
  const deals: Deal[] = [
    { id: "m1", name: "Snell Isle — 3 openings", amount: 8400, stage: "Quoted", closeDate: "2026-06-20" },
    { id: "m2", name: "Shore Acres garage + entry", amount: 4200, stage: "Assessment booked", closeDate: "2026-06-18" },
    { id: "m3", name: "St. Pete Beach storefront", amount: 14800, stage: "Negotiation", closeDate: "2026-06-25" },
    { id: "m4", name: "Clearwater duplex", amount: 6100, stage: "Contract sent", closeDate: "2026-06-15" },
    { id: "m5", name: "Tampa Bayshore condo", amount: 9300, stage: "Qualified", closeDate: "2026-07-02" },
    { id: "m6", name: "Gulfport cottage", amount: 3800, stage: "Won", closeDate: "2026-06-05" },
    { id: "m7", name: "Tierra Verde waterfront", amount: 18200, stage: "Won", closeDate: "2026-06-02" },
    { id: "m8", name: "Largo rental", amount: 2900, stage: "Lost", closeDate: "2026-05-28" },
  ];
  const contacts: Contact[] = [
    { id: "c1", name: "Rolanda Fields", email: "rolanda@example.com", phone: "(727) 555-0142", stage: "lead", created: "2026-06-05" },
    { id: "c2", name: "David Stern", email: "dstern@example.com", phone: "(727) 555-0188", stage: "opportunity", created: "2026-06-04" },
    { id: "c3", name: "Tammy White", email: "tammyw@example.com", phone: "(727) 555-0119", stage: "customer", created: "2026-06-03" },
    { id: "c4", name: "Damon Cole", email: "dcole@example.com", phone: "(727) 555-0173", stage: "lead", created: "2026-06-02" },
    { id: "c5", name: "Jennifer Park", email: "jpark@example.com", phone: "(727) 555-0150", stage: "opportunity", created: "2026-06-01" },
  ];
  const tasks: Task[] = [
    { id: "t1", title: "Follow up — St. Pete Beach storefront quote", due: "Today", status: "due" },
    { id: "t2", title: "Send contract — Clearwater duplex", due: "Today", status: "due" },
    { id: "t3", title: "Confirm assessment — Shore Acres", due: "Tomorrow", status: "upcoming" },
  ];
  return { connected: false, deals, contacts, tasks, ...derive(deals, contacts) };
}

export const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
