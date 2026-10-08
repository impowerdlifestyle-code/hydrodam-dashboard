import "server-only";
import { after } from "next/server";
import {
  createVisit, db, DB_LIVE, ensureData, getClient, getRequest, getStaff, getVisit, invalidate, propertyFor, realClientId,
  realRequestId, saveProperty, updateRequest, updateVisit,
} from "@/lib/db";
import { syncTransition, unbookAssessment } from "@/lib/crm-sync";
import { addDaysKey, dayKey, formatKey, longDate, startOfWeekKey, timeRange, todayKey, weekdayOfKey } from "@/lib/format";
import { esc, p, sendEmail, shell, teamRecipients } from "@/lib/mail";
import { portalOrigin } from "@/lib/portal";
import { textClient } from "@/lib/comms";
import { bookingText, smsFor } from "@/lib/text-automations";
import { VISIT_KIND_LABEL, render } from "@/lib/templates";
import * as pg from "@/lib/supabase";
import type { Visit } from "@/lib/types";

/**
 * Self-serve booking of the on-site assessment.
 *
 * Emma books assessments today by phone, off a lead notification. The portal
 * lets the customer pick the slot themselves against the same calendar the
 * office works from: a visit row, assigned to the assessor, visible on the
 * Schedule screen and to the 24-hour reminder. HubSpot moves to Measurement
 * Scheduled through the same transition the office button fires.
 */

export const ASSESSMENT_MINUTES = 60;
const TZ = "America/New_York";
const START_HOURS = [9, 10, 11, 12, 13, 14, 15];
const LEAD_TIME_HOURS = 24;
const HORIZON_DAYS = 21;
const ACTIVE_VISIT = new Set<Visit["status"]>(["scheduled", "confirmed", "en_route", "in_progress"]);

export type Slot = { startISO: string; label: string };
export type SlotDay = { key: string; label: string; slots: Slot[] };

/**
 * The people who can take an assessment: office staff first, then the owner.
 * Availability used to hang on Emma alone, so one busy afternoon of hers
 * emptied the customer's picker while Mady was free.
 */
export function assessorIds(): string[] {
  const staff = db().staff.filter((s) => s.active);
  return [
    ...staff.filter((s) => s.role === "office"),
    ...staff.filter((s) => s.role === "owner"),
  ].map((s) => s.id);
}

function busyVisits(assessors: string[]): Visit[] {
  return db().visits.filter(
    (v) => ACTIVE_VISIT.has(v.status) && v.scheduledStart && v.assignedTo.some((id) => assessors.includes(id))
  );
}

/** The first assessor, in preference order, with nothing overlapping that slot. */
function freeAssessor(startISO: string): string | undefined {
  const assessors = assessorIds();
  const busy = busyVisits(assessors);
  const endISO = new Date(Date.parse(startISO) + ASSESSMENT_MINUTES * 60_000).toISOString();
  return assessors.find((id) => !busy.some((v) => v.assignedTo.includes(id) && overlaps(v, startISO, endISO)));
}

/** The UTC instant of a wall-clock hour on a given day in HydroDam's timezone. */
function instantOf(key: string, hour: number): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(guess));
  const name = parts.find((x) => x.type === "timeZoneName")?.value ?? "GMT-5";
  const offset = Number(name.replace("GMT", "") || 0);
  return new Date(guess - offset * 3_600_000);
}

/** The Schedule screen pages by week offset from this week, not by date. */
export function scheduleHref(iso: string): string {
  const [ty, tm, td] = startOfWeekKey(todayKey()).split("-").map(Number);
  const [vy, vm, vd] = startOfWeekKey(dayKey(iso)).split("-").map(Number);
  const weeks = Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(ty, tm - 1, td)) / (7 * 86_400_000));
  return `${portalOrigin()}/schedule?w=${weeks}`;
}

function overlaps(v: Visit, startISO: string, endISO: string): boolean {
  return v.scheduledStart < endISO && v.scheduledEnd > startISO;
}

export function availableSlots(): SlotDay[] {
  const assessors = assessorIds();
  const busy = busyVisits(assessors);
  const earliest = new Date(Date.now() + LEAD_TIME_HOURS * 3_600_000).toISOString();
  const days: SlotDay[] = [];

  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const key = addDaysKey(todayKey(), i);
    const weekday = weekdayOfKey(key);
    if (weekday === 0 || weekday === 6) continue;

    const slots = START_HOURS.flatMap((hour) => {
      const start = instantOf(key, hour);
      const end = new Date(start.getTime() + ASSESSMENT_MINUTES * 60_000);
      const startISO = start.toISOString();
      if (startISO < earliest) return [];
      // Every assessor busy at once is what makes a slot unavailable.
      const free = assessors.some((id) => !busy.some((v) => v.assignedTo.includes(id) && overlaps(v, startISO, end.toISOString())));
      if (!free) return [];
      return [{ startISO, label: start.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) }];
    });
    if (slots.length) days.push({ key, label: formatKey(key, { weekday: "short", month: "short", day: "numeric" }), slots });
  }
  return days;
}

/** The assessment on the calendar for this client, if one is coming up. */
export function upcomingAssessment(clientId: string): Visit | undefined {
  return db()
    .visits.filter((v) => v.clientId === clientId && v.kind === "assessment" && ACTIVE_VISIT.has(v.status) && v.scheduledStart)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
}

export function completedAssessment(clientId: string): Visit | undefined {
  return db().visits.find((v) => v.clientId === clientId && v.kind === "assessment" && v.status === "completed");
}

export type BookInput = {
  startISO: string;
  address?: { line1: string; city: string; postalCode: string };
  notes?: string;
};

export async function bookAssessment(
  clientId: string,
  input: BookInput,
  audit: { ip?: string }
): Promise<{ ok: boolean; message: string; visitId?: string }> {
  if (!DB_LIVE) return { ok: false, message: "Booking is not available right now. Please call us." };
  await ensureData({ fresh: true });

  const slot = availableSlots().flatMap((d) => d.slots).find((s) => s.startISO === input.startISO);
  if (!slot) return { ok: false, message: "That time has just been taken. Please pick another." };
  if (upcomingAssessment(clientId)) return { ok: false, message: "You already have an assessment booked." };

  const { clientId: realId } = await realClientId(clientId);
  let property = propertyFor(realId);
  if (!property) {
    const a = input.address;
    if (!a?.line1?.trim() || !a.city?.trim() || !/^\d{5}(-\d{4})?$/.test(a.postalCode?.trim() ?? "")) {
      return { ok: false, message: "Please tell us the address we are visiting." };
    }
    await saveProperty(realId, { address: a.line1.trim(), city: a.city.trim(), postalCode: a.postalCode.trim() });
    await ensureData({ fresh: true });
    property = propertyFor(realId);
  }

  const request = await openRequestFor(realId, input.notes);
  const staffId = freeAssessor(input.startISO);
  const visitId = await createVisit({
    requestId: request.id,
    kind: "assessment",
    title: "On-site assessment",
    startISO: input.startISO,
    minutes: ASSESSMENT_MINUTES,
    staffIds: staffId ? [staffId] : [],
  });
  if (!visitId) return { ok: false, message: "We could not save that booking. Please call us." };

  const patch: Parameters<typeof updateRequest>[1] = {};
  if (input.notes?.trim()) patch.details = [request.details, `Booking note: ${input.notes.trim()}`].filter(Boolean).join("\n");
  if (!request.firstResponseAt) patch.firstResponseAt = new Date().toISOString();
  if (Object.keys(patch).length) await updateRequest(request.id, patch);

  if (request.status !== "assessment_scheduled") {
    await syncTransition(
      { entity: "request", from: request.status, to: "assessment_scheduled" },
      getClient(realId)?.hubspotContactId,
      { note: `Customer booked their on-site assessment online for ${longDate(input.startISO)}.` }
    );
  }

  const endISO = new Date(Date.parse(input.startISO) + ASSESSMENT_MINUTES * 60_000).toISOString();
  after(() => notifyBooking(realId, input.startISO, endISO, property?.address, audit.ip));
  invalidate();
  return { ok: true, message: `Booked for ${longDate(input.startISO)}, ${timeRange(input.startISO, endISO)}.`, visitId };
}

export async function cancelAssessment(clientId: string, visitId: string): Promise<{ ok: boolean; message: string }> {
  if (!DB_LIVE) return { ok: false, message: "Not available right now." };
  await ensureData({ fresh: true });
  const visit = upcomingAssessment(clientId);
  if (!visit || visit.id !== visitId) return { ok: false, message: "That booking is no longer on the calendar." };
  if (!CANCELLABLE.has(visit.status)) {
    return { ok: false, message: "Our team is already on the way. Please call us to change it." };
  }
  await unbook(visit, "customer");

  const client = getClient(clientId);
  const [to, ...cc] = teamRecipients();
  after(() => sendEmail({
    to,
    cc,
    subject: `Assessment cancelled by customer: ${client?.name ?? clientId}`,
    html: shell({
      heading: "A customer cancelled their assessment",
      body: p(`${esc(client?.name ?? "A customer")} cancelled the on-site assessment that was booked for ${esc(longDate(visit.scheduledStart))}, ${esc(timeRange(visit.scheduledStart, visit.scheduledEnd))}. They can rebook from their portal, or you can reach them to reschedule.`),
      cta: { label: "Open the schedule", href: scheduleHref(visit.scheduledStart) },
    }),
  }));
  return { ok: true, message: "Cancelled. Pick a new time whenever you are ready." };
}

/** The office taking an assessment off the calendar. Nothing is sent to the customer. */
export async function cancelAssessmentByOffice(visitId: string): Promise<{ ok: boolean; message: string }> {
  const visit = getVisit(visitId);
  if (!visit || visit.kind !== "assessment" || !ACTIVE_VISIT.has(visit.status)) {
    return { ok: false, message: "That assessment is no longer on the calendar." };
  }
  if (!CANCELLABLE.has(visit.status)) {
    return { ok: false, message: "This visit is already under way, so it cannot be cancelled from here." };
  }
  await unbook(visit, "office");
  return { ok: true, message: "Assessment cancelled. The lead is back to contacted." };
}

const CANCELLABLE = new Set<Visit["status"]>(["scheduled", "confirmed"]);

/**
 * Cancel the visit and, when it was the request's only booking, step the
 * request back to contacted so the Requests board and HubSpot stop saying an
 * assessment is scheduled.
 */
async function unbook(visit: Visit, by: "customer" | "office"): Promise<void> {
  await updateVisit(visit.id, { status: "cancelled" });

  const request = visit.requestId ? getRequest(visit.requestId) : undefined;
  const stillBooked = db().visits.some(
    (v) => v.id !== visit.id && v.requestId === visit.requestId && v.kind === "assessment" && ACTIVE_VISIT.has(v.status)
  );
  if (request?.status === "assessment_scheduled" && !stillBooked) {
    await updateRequest(request.id, { status: "contacted" });
  }

  const who = by === "customer" ? "Customer cancelled their" : "Office cancelled the";
  await unbookAssessment(
    getClient(visit.clientId)?.hubspotContactId,
    `${who} on-site assessment for ${longDate(visit.scheduledStart)}. Cancelled in HydroDam Ops.`
  );
  invalidate();
}

/** The request the visit hangs off: the newest open one, or a fresh one when the client has none. */
/**
 * The office booking an assessment from a client's profile. Reuses their open
 * request, or opens one, so the visit lands on the same record as everything
 * else about them, and the customer gets the same confirmation as booking it
 * themselves from the portal.
 */
export async function bookAssessmentForClient(input: {
  clientId: string;
  startISO: string;
  minutes: number;
  staffIds: string[];
}): Promise<{ ok: boolean; message: string }> {
  if (!DB_LIVE) return { ok: false, message: "Connect Supabase first. This writes to the database." };
  await ensureData({ fresh: true });

  const { clientId } = await realClientId(input.clientId);
  const request = await openRequestFor(clientId);
  const visitId = await createVisit({
    requestId: request.id,
    kind: "assessment",
    title: "On-site assessment",
    startISO: input.startISO,
    minutes: input.minutes,
    staffIds: input.staffIds,
  });
  if (!visitId) return { ok: false, message: "Could not save that booking." };

  if (request.status !== "assessment_scheduled") {
    await syncTransition(
      { entity: "request", from: request.status, to: "assessment_scheduled" },
      getClient(clientId)?.hubspotContactId,
      { note: `Office booked the on-site assessment for ${longDate(input.startISO)}.` }
    );
  }

  const endISO = new Date(Date.parse(input.startISO) + input.minutes * 60_000).toISOString();
  after(() => confirmToCustomer(clientId, input.startISO, endISO, propertyFor(clientId)?.address));
  invalidate();
  return { ok: true, message: `Booked for ${longDate(input.startISO)}, ${timeRange(input.startISO, endISO)}. The customer gets a confirmation.` };
}

/** Confirms a visit the office booked from a request page. */
export function confirmOfficeBooking(clientId: string, startISO: string, minutes: number) {
  const endISO = new Date(Date.parse(startISO) + minutes * 60_000).toISOString();
  after(() => confirmToCustomer(clientId, startISO, endISO, propertyFor(clientId)?.address));
}

async function openRequestFor(clientId: string, notes?: string) {
  const open = db()
    .requests.filter((r) => r.clientId === clientId && !r.demo && !["converted", "unqualified"].includes(r.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (open) {
    const { requestId } = await realRequestId(open.id);
    return { ...open, id: requestId };
  }

  const company = await pg.rpc<string>("company_id", {});
  const number = await pg.rpc<number>("next_doc_number", { p_company: company, p_type: "request" });
  const [row] = await pg.insert<{ id: string }>("requests", {
    company_id: company,
    number,
    client_id: clientId,
    property_id: propertyFor(clientId)?.id ?? null,
    status: "new",
    source: "portal",
    title: "Flood barrier assessment",
    details: notes?.trim() || null,
  });
  invalidate();
  await ensureData({ fresh: true });
  return { id: row.id, status: "new" as const, details: notes?.trim() || undefined, firstResponseAt: undefined };
}

async function notifyBooking(clientId: string, startISO: string, endISO: string, address: string | undefined, ip?: string) {
  const client = getClient(clientId);
  if (!client) return;
  const when = `${longDate(startISO)}, ${timeRange(startISO, endISO)}`;

  const [to, ...cc] = teamRecipients();
  await sendEmail({
    to,
    cc,
    subject: `Assessment booked online: ${client.name}, ${when}`,
    replyTo: client.email,
    html: shell({
      heading: "A customer booked their assessment",
      body:
        p(`<strong>${esc(client.name)}</strong> picked <strong>${esc(when)}</strong> from their portal.`) +
        p([address && `Address: ${esc(address)}`, client.phone && `Phone: ${esc(client.phone)}`, client.email && `Email: ${esc(client.email)}`, ip && `Booked from ${esc(ip)}`].filter(Boolean).join("<br>")) +
        p("It is on the Schedule now. The 24-hour reminder goes out automatically."),
      cta: { label: "Open the schedule", href: scheduleHref(startISO) },
    }),
  });

  await confirmToCustomer(clientId, startISO, endISO, address);
}

/** The customer's own confirmation, by text and email, however the visit was booked. */
async function confirmToCustomer(clientId: string, startISO: string, endISO: string, address: string | undefined) {
  const client = getClient(clientId);
  if (!client) return;
  const when = `${longDate(startISO)}, ${timeRange(startISO, endISO)}`;

  if (client.phone) {
    const ctx = {
      firstName: client.name.split(" ")[0] || "there",
      companyPhone: "(727) 613-1415",
      visitDate: longDate(startISO),
      visitWindow: timeRange(startISO, endISO).replace(/\s*[—–]\s*/, " to "),
      address,
    };
    const text = await smsFor("appointment_confirm", ctx, bookingText(ctx));
    await textClient({ clientId, phone: client.phone, body: text, templateKey: "appointment_confirm" })
      .then((r) => { if (!r.sent) console.info("[booking] confirmation text not sent:", r.reason); })
      .catch((err) => console.warn("[booking] confirmation text failed", err));
  }

  if (client.email) {
    await sendEmail({
      to: client.email,
      clientId,
      subject: `Your HydroDam assessment is booked: ${longDate(startISO)}`,
      html: shell({
        heading: "You are booked",
        body:
          p(`We will be with you on <strong>${esc(when)}</strong>${address ? ` at ${esc(address)}` : ""}.`) +
          p("The visit takes about an hour. We measure every opening you want protected, check the surface each barrier seals against, and confirm what the install involves. Please make sure we can reach each opening.") +
          p("Need to change it? Open your project and pick a new time, or call us on (727) 613-1415."),
      }),
    });
  }
}

/**
 * The text a customer gets when the crew taps "I'm on my way". The office
 * switch on the Automations page decides whether it sends, and the dedupe key
 * means tapping twice texts once.
 */
export async function textOnMyWay(visitId: string): Promise<void> {
  await ensureData();
  const visit = getVisit(visitId);
  const client = visit && getClient(visit.clientId);
  if (!visit || !client?.phone) return;
  if (!db().automations.find((a) => a.key === "on_my_way")?.armed) return;

  const prop = db().properties.find((p) => p.id === visit.propertyId);
  const ctx = {
    firstName: client.name.split(" ")[0] || "there",
    companyPhone: "(727) 613-1415",
    crewName: getStaff(visit.assignedTo[0] ?? "")?.name.trim().split(/\s+/)[0],
    visitKind: VISIT_KIND_LABEL[visit.kind],
    address: prop ? `${prop.address}, ${prop.city}` : undefined,
  };
  const text = await smsFor("on_my_way", ctx, render("on_my_way", ctx)?.sms ?? "");
  await textClient({
    clientId: client.id,
    phone: client.phone,
    body: text,
    templateKey: "on_my_way",
    dedupeKey: `on_my_way:visit:${visit.id}`,
  })
    .then((r) => { if (!r.sent) console.info("[visit] on-my-way text not sent:", r.reason); })
    .catch((err) => console.warn("[visit] on-my-way text failed", err));
}
