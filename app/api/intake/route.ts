import { NextResponse } from "next/server";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { toE164 } from "@/lib/telnyx";
import { p, sendEmail, shell, teamRecipients, esc } from "@/lib/mail";
import { render } from "@/lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where a lead actually enters the system.
 *
 * Until now nothing arrived here on its own: leads reached the dashboard only
 * by way of a ten-minute HubSpot poll, which meant the fastest possible reply
 * to a form submission was ten minutes plus whenever somebody looked. This is
 * the direct path — thehydrodam.com posts here the moment the form is
 * submitted, and speed-to-lead has something to fire on.
 *
 * HubSpot stays the lead list and keeps receiving the same submission from the
 * marketing site; the two do not fight, because a contact promoted here carries
 * its HubSpot id and the merge de-duplicates on it.
 *
 * Auth is a shared secret, because the caller is a server, not a browser. The
 * marketing site's form is public; this endpoint is not.
 */

type Body = {
  externalId?: string;
  source?: string;
  sourceUrl?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  floodZone?: string;
  message?: string;
  estimateLowCents?: number;
  estimateHighCents?: number;
  estimatePayload?: unknown;
  hubspotContactId?: string;
  openings?: { label?: string; type?: string; widthIn?: number; heightIn?: number; quantity?: number }[];
  smsConsent?: boolean;
  /** The exact wording shown next to the tick. Evidence, never paraphrased. */
  consentWording?: string;
};

const OPENING_TYPES = new Set([
  "door", "double_door", "single_garage", "double_garage", "slider", "storefront", "window", "custom",
]);

export async function POST(req: Request) {
  const secret = process.env.INTAKE_SECRET;
  const provided = req.headers.get("x-intake-secret") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!SUPABASE_LIVE) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() || undefined;
  const phone = body.phone?.trim() ? toE164(body.phone) : undefined;
  if (!email && !phone) {
    return NextResponse.json({ error: "An email or a phone number is required." }, { status: 400 });
  }

  try {
    const company = await pg.rpc<string>("company_id", {});
    const source = body.source?.trim() || "website_form";
    const externalId = body.externalId?.trim() || `${source}:${email ?? phone}:${Date.now()}`;

    // Idempotent on (source, external_id): a double-submitted form, or a retry
    // from the marketing site, must not create a second request.
    const [existing] = await pg.select<{ id: string; number: number; client_id: string }>("requests", {
      select: "id,number,client_id",
      source: `eq.${source}`,
      external_id: `eq.${externalId}`,
      limit: "1",
    });
    if (existing) {
      return NextResponse.json({ ok: true, requestId: existing.id, number: existing.number, deduped: true });
    }

    const clientId = await upsertClient(company, { ...body, email, phone });
    const propertyId = body.address?.trim()
      ? await upsertProperty(company, clientId, body)
      : undefined;

    if (propertyId && body.openings?.length) {
      await addOpenings(company, propertyId, body.openings);
    }

    // The tick grants BOTH channels, because the label the person read covers
    // both: appointment and service updates as well as marketing. Writing only
    // sms_marketing left every website opt-in with no transactional consent,
    // which is the channel the send gate and the Inbox actually read.
    if (body.smsConsent && phone && body.consentWording) {
      await pg.insert(
        "consents",
        (["sms_transactional", "sms_marketing"] as const).map((channel) => ({
          company_id: company,
          client_id: clientId,
          phone,
          channel,
          action: "granted",
          wording: body.consentWording,
          source,
          source_url: body.sourceUrl ?? null,
        }))
      );
    }

    const number = await pg.rpc<number>("next_doc_number", { p_company: company, p_type: "request" });
    const [request] = await pg.insert<{ id: string; number: number }>("requests", {
      company_id: company,
      number,
      client_id: clientId,
      property_id: propertyId ?? null,
      status: "new",
      source,
      source_url: body.sourceUrl ?? null,
      external_id: externalId,
      title: "Flood barrier assessment",
      details: body.message?.trim() || null,
      estimate_low_cents: body.estimateLowCents ?? null,
      estimate_high_cents: body.estimateHighCents ?? null,
      estimate_payload: body.estimatePayload ?? null,
      hubspot_deal_id: null,
    });

    // The acknowledgement goes out now rather than on tomorrow's cron — a lead
    // that submits at 9am should not hear nothing until the next sweep. Claiming
    // the speed_to_lead dedupe key here is what stops the cron sending it twice.
    if (request?.id && email) {
      await claimSpeedToLead(company, clientId, request.id);
    }

    // Best-effort, and deliberately after the row is committed: the office
    // hearing about a lead must never be what decides whether the lead exists.
    void notifyTeam(body, request?.number, email, phone);

    return NextResponse.json({ ok: true, requestId: request?.id, number: request?.number });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 300) : "Intake failed." },
      { status: 500 }
    );
  }
}

/**
 * Reserves the exact key `lib/automations.ts` would use, so the daily sweep
 * finds this lead already handled. The two paths share one dedupe space by
 * construction rather than by both remembering to check a flag.
 */
async function claimSpeedToLead(company: string, clientId: string, requestId: string): Promise<void> {
  try {
    await pg.insert("message_sends", {
      company_id: company,
      dedupe_key: `speed_to_lead:request:${requestId}:0`,
      automation_id: "speed_to_lead",
      step_id: "0",
      occurrence: 0,
      client_id: clientId,
      channel: "email",
      anchor_date: new Date().toISOString().slice(0, 10),
      status: "sent",
      sent_at: new Date().toISOString(),
    });
  } catch {
    // Already claimed. Nothing to do.
  }
}

async function upsertClient(
  company: string,
  body: Body & { email?: string; phone?: string }
): Promise<string> {
  // Match on the HubSpot id first, then email, then phone — the same order the
  // dedupe indexes are built in.
  const lookups: Record<string, string>[] = [];
  if (body.hubspotContactId) lookups.push({ hubspot_contact_id: `eq.${body.hubspotContactId}` });
  if (body.email) lookups.push({ email: `eq.${body.email}` });
  if (body.phone) lookups.push({ phone: `eq.${body.phone}` });

  for (const q of lookups) {
    const [found] = await pg.select<{ id: string }>("clients", { select: "id", ...q, limit: "1" });
    if (found) return found.id;
  }

  const parts = (body.name ?? "").trim().split(/\s+/).filter(Boolean);
  const [created] = await pg.insert<{ id: string }>("clients", {
    company_id: company,
    type: "residential",
    first_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || body.email || body.phone,
    last_name: parts.length > 1 ? parts.at(-1) : null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    lead_source: body.source?.trim() || "Website form",
    hubspot_contact_id: body.hubspotContactId ?? null,
  });
  return created.id;
}

/** Street addresses are typed by humans; compare them the way humans mean them. */
const normalizeAddress = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Matched on the address, not merely on the client.
 *
 * A returning customer is often a returning customer *for a different
 * building* — a landlord, a second home, someone who moved. Reusing whatever
 * property happened to be on file would file the new measurements against the
 * wrong house, and openings are the thing a quote is priced from.
 */
async function upsertProperty(company: string, clientId: string, body: Body): Promise<string> {
  const address = body.address!.trim();

  const existing = await pg.select<{ id: string; address_line1: string }>("properties", {
    select: "id,address_line1", client_id: `eq.${clientId}`, order: "is_primary.desc,created_at.asc", limit: "20",
  });
  const match = existing.find((p) => normalizeAddress(p.address_line1) === normalizeAddress(address));
  if (match) return match.id;

  const [created] = await pg.insert<{ id: string }>("properties", {
    company_id: company,
    client_id: clientId,
    label: "Service address",
    address_line1: address,
    // The form collects one address line; city and ZIP are confirmed at the
    // assessment rather than guessed here.
    city: body.city?.trim() || "Unknown",
    state: "FL",
    postal_code: body.postalCode?.trim() || "00000",
    flood_zone: ["X", "AE", "A", "VE"].includes(body.floodZone ?? "") ? body.floodZone : null,
    // `properties_one_primary` is a partial unique index, so only the first
    // address a client gives us can claim it.
    is_primary: existing.length === 0,
  });
  return created.id;
}

/**
 * Openings are additive but not duplicative.
 *
 * Somebody re-running the estimator with the same front door must not end up
 * with two front doors on the property, because a quote prices every opening
 * on file and the customer would be quoted twice for one barrier.
 */
async function addOpenings(
  company: string,
  propertyId: string,
  openings: NonNullable<Body["openings"]>
): Promise<void> {
  const existing = await pg.select<{ label: string; width_in: string; protection_height_in: string }>(
    "openings",
    { select: "label,width_in,protection_height_in", property_id: `eq.${propertyId}`, limit: "100" }
  );
  const seen = new Set(
    existing.map((o) => `${o.label.trim().toLowerCase()}|${Number(o.width_in)}|${Number(o.protection_height_in)}`)
  );

  const rows: Record<string, unknown>[] = [];
  openings
    .filter((o) => (o.widthIn ?? 0) > 0 && (o.heightIn ?? 0) > 0)
    .slice(0, 40)
    .forEach((o, i) => {
      const label = o.label?.trim() || `Opening ${i + 1}`;
      const key = `${label.toLowerCase()}|${o.widthIn}|${o.heightIn}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        company_id: company,
        property_id: propertyId,
        label,
        type: OPENING_TYPES.has(o.type ?? "") ? o.type : "custom",
        width_in: o.widthIn,
        protection_height_in: o.heightIn,
        sort_order: existing.length + rows.length,
      });
    });

  if (rows.length) await pg.insert("openings", rows);
}

async function notifyTeam(
  body: Body,
  number: number | undefined,
  email?: string,
  phone?: string
): Promise<void> {
  const rows = [
    ["Name", body.name],
    ["Email", email],
    ["Phone", phone],
    ["Address", body.address],
    ["Ballpark", body.estimateLowCents ? `$${(body.estimateLowCents / 100).toLocaleString()}–$${((body.estimateHighCents ?? 0) / 100).toLocaleString()}` : undefined],
    ["Openings", body.openings?.length ? String(body.openings.length) : undefined],
    ["Said", body.message],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => p(`<strong>${k}:</strong> ${esc(String(v))}`))
    .join("");

  const [to, ...cc] = teamRecipients();
  await sendEmail({
    to,
    cc,
    subject: `New request${number ? ` #${number}` : ""} — ${body.name ?? email ?? phone}`,
    replyTo: email,
    html: shell({
      heading: `New request${number ? ` #${number}` : ""}`,
      body: rows + p("It is in the dashboard now, in the Requests queue."),
      cta: { label: "Open the request", href: "https://hydrodam-dashboard.vercel.app/requests" },
    }),
  });

  // The customer's own acknowledgement is the speed_to_lead template, sent
  // immediately rather than waiting for the daily cron — a lead that submits at
  // 9am should not hear nothing until tomorrow.
  if (email) {
    const rendered = render("speed_to_lead", {
      firstName: (body.name ?? "").trim().split(/\s+/)[0] || "there",
      companyPhone: "(727) 613-1415",
    });
    if (rendered) await sendEmail({ to: email, subject: rendered.subject, html: rendered.html });
  }
}
