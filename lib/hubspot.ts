import "server-only";
import { unstable_cache } from "next/cache";
import type { Client, Property, ServiceRequest, RequestStatus } from "@/lib/types";

/**
 * HubSpot is HydroDam's real system of record for people. It is a lead list,
 * not a client book: ~3,000 contacts, of which ~140 carry a street address and
 * none are marked `customer`. Deals are auto-generated estimate-calculator
 * submissions and every one of them sits in `appointmentscheduled`.
 *
 * So this module maps contacts → Client + ServiceRequest, and attaches a
 * Property only where HubSpot actually holds an address. Nothing is invented to
 * fill a gap: an absent field stays absent and the UI renders a dash.
 */

const BASE = "https://api.hubapi.com";
// The production value was stored with a trailing newline (piped into
// `vercel env add`), which survives into the Authorization header. fetch
// currently tolerates it; a stricter runtime would reject the header outright.
const token = () => process.env.HUBSPOT_TOKEN?.trim();

export const CRM_LIVE = Boolean(process.env.HUBSPOT_TOKEN);

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "phone", "mobilephone",
  "address", "city", "state", "zip",
  "lifecyclestage", "createdate", "hs_lead_status", "notes_last_contacted",
  "lead_source", "contact_form", "comments_or_questions",
] as const;

const DEAL_PROPS = ["dealname", "amount", "dealstage", "createdate"] as const;

type HsRecord = { id: string; properties: Record<string, string | null> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * HubSpot's search endpoint allows 4 requests/second and 100 per 10s across the
 * app. Paging ~3,000 contacts is 30 calls, so this throttles deliberately and
 * backs off on 429 rather than giving up — an unhandled 429 silently truncated
 * the contact list to 300 rows, which looked like a complete result.
 */
async function hsPost<T>(path: string, body: unknown, attempt = 0): Promise<T | null> {
  const t = token();
  if (!t) return null;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) return null;
    const retryAfter = Number(res.headers.get("Retry-After")) * 1000;
    await sleep(retryAfter || 2 ** attempt * 500);
    return hsPost<T>(path, body, attempt + 1);
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function searchAll(object: string, properties: readonly string[], cap: number): Promise<HsRecord[]> {
  if (!token()) return [];
  const out: HsRecord[] = [];
  let after: string | undefined;

  while (out.length < cap) {
    const body: Record<string, unknown> = {
      limit: 100,
      properties,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    };
    if (after) body.after = after;

    const page = await hsPost<{ results?: HsRecord[]; paging?: { next?: { after?: string } } }>(
      `/crm/v3/objects/${object}/search`,
      body,
    );
    if (!page) break;

    out.push(...(page.results ?? []));
    after = page.paging?.next?.after;
    if (!after) break;
    await sleep(260);
  }
  return out;
}

async function dealContactIds(dealIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!token() || !dealIds.length) return map;

  for (let i = 0; i < dealIds.length; i += 100) {
    const page = await hsPost<{ results?: { from: { id: string }; to: { toObjectId: string }[] }[] }>(
      "/crm/v4/associations/deals/contacts/batch/read",
      { inputs: dealIds.slice(i, i + 100).map((id) => ({ id })) },
    );
    if (!page) continue;
    for (const r of page.results ?? []) {
      const first = r.to?.[0]?.toObjectId;
      if (first) map.set(r.from.id, String(first));
    }
    await sleep(260);
  }
  return map;
}

// HubSpot's lead status is the only signal for where a lead actually stands —
// lifecyclestage is 98% "lead" and the custom pipeline fields were never filled in.
const LEAD_STATUS: Record<string, RequestStatus> = {
  NEW: "new",
  OPEN_DEAL: "assessment_scheduled",
  ATTEMPTED_TO_CONTACT: "contacted",
  "Future Follow Up": "contacted",
  "Itimized Estimate Pending": "assessed",
  UNQUALIFIED: "unqualified",
  "Inadequate Contact Info": "unqualified",
};

const SOURCE_LABEL: Record<string, string> = {
  NEW: "Website",
  OPEN_DEAL: "Estimate calculator",
};

/** Deal names carry the calculator's own range: "Name — Sentinel Series ($6,400 to $8,500)". */
function rangeFromDealName(name: string): { lowCents?: number; highCents?: number } {
  const m = name.match(/\$([\d,]+)\s*to\s*\$([\d,]+)/);
  if (!m) return {};
  const n = (s: string) => Number(s.replace(/,/g, "")) * 100;
  return { lowCents: n(m[1]), highCents: n(m[2]) };
}

function displayName(p: Record<string, string | null>): string {
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
  return name || p.email || "Unnamed contact";
}

export type CrmSnapshot = {
  clients: Client[];
  properties: Property[];
  requests: ServiceRequest[];
  fetchedAt: string;
  contactCount: number;
  addressedCount: number;
};

/**
 * Shared across server instances via the Next data cache, not just the
 * in-process singleton. Without it every cold lambda re-pages the whole CRM and
 * the first visitor on that instance waits ~17s. One instance pays the cost and
 * the rest read it.
 *
 * A failure THROWS rather than returning null, and that is deliberate: the data
 * cache stores whatever the function returns, so a returned null would pin an
 * empty CRM in front of every visitor for the full ten minutes. Errors are not
 * cached, so a 429 or an expired token costs one slow request, not ten minutes
 * of a dashboard reporting zero contacts. The caller treats a throw as "leave
 * the last good snapshot alone".
 */
const cachedFetch = unstable_cache(fetchCrmUncached, ["hubspot-crm-snapshot"], {
  revalidate: 600,
  tags: ["crm"],
});

export async function fetchCrm(): Promise<CrmSnapshot | null> {
  if (!CRM_LIVE) return null;
  return cachedFetch();
}

async function fetchCrmUncached(): Promise<CrmSnapshot> {
  // Sequential on purpose — these two share one rate-limit bucket.
  const contacts = await searchAll("contacts", CONTACT_PROPS, 5000);
  if (!contacts.length) throw new Error("HubSpot returned no contacts — token or rate limit.");
  const deals = await searchAll("deals", DEAL_PROPS, 1000);

  const dealByContact = new Map<string, HsRecord>();
  const assoc = await dealContactIds(deals.map((d) => d.id));
  for (const d of deals) {
    const contactId = assoc.get(d.id);
    if (contactId) dealByContact.set(contactId, d);
  }

  const clients: Client[] = [];
  const properties: Property[] = [];
  const requests: ServiceRequest[] = [];
  let number = 1000;

  for (const c of contacts) {
    const p = c.properties;
    const id = `hs_${c.id}`;
    const createdAt = p.createdate ?? new Date().toISOString();
    const status = LEAD_STATUS[p.hs_lead_status ?? ""] ?? "new";

    clients.push({
      id,
      name: displayName(p),
      email: p.email ?? undefined,
      phone: p.phone ?? p.mobilephone ?? undefined,
      // HubSpot holds no company or property-type field for these contacts, so
      // everything reads residential until Mady classifies them.
      type: "residential",
      leadSource: p.lead_source ?? (p.contact_form ? "Website form" : "HubSpot"),
      // HubSpot has no consent record. Nobody here has opted in to SMS.
      smsConsent: false,
      tags: p.hs_lead_status ? [p.hs_lead_status] : [],
      createdAt,
      hubspotContactId: c.id,
    });

    // A street line alone is enough to be worth measuring. City/zip are sparser
    // still, so they stay empty rather than being guessed from the street.
    if (p.address) {
      properties.push({
        id: `hsp_${c.id}`,
        clientId: id,
        label: "Property",
        address: p.address,
        city: p.city ?? "",
        state: p.state ?? "",
        postalCode: p.zip ?? "",
      });
    }

    const deal = dealByContact.get(c.id);
    const range = deal ? rangeFromDealName(deal.properties.dealname ?? "") : {};

    requests.push({
      id: `hsr_${c.id}`,
      number: number++,
      clientId: id,
      propertyId: p.address ? `hsp_${c.id}` : undefined,
      status,
      source: p.lead_source ?? (deal ? "Estimate calculator" : SOURCE_LABEL[p.hs_lead_status ?? ""] ?? "HubSpot"),
      title: deal?.properties.dealname ?? p.contact_form ?? `Enquiry — ${displayName(p)}`,
      details: p.comments_or_questions ?? undefined,
      estimateLowCents: range.lowCents,
      estimateHighCents: range.highCents,
      createdAt,
      // HubSpot records LAST contacted, not first. The Requests page labels this
      // accordingly when the CRM is live — do not read it as speed-to-lead.
      firstResponseAt: p.notes_last_contacted ?? undefined,
    });
  }

  return {
    clients,
    properties,
    requests,
    fetchedAt: new Date().toISOString(),
    contactCount: contacts.length,
    addressedCount: properties.length,
  };
}
