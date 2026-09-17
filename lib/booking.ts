import "server-only";
import {
  createVisit, db, DB_LIVE, ensureData, getClient, invalidate, propertyFor, realClientId, realRequestId,
  saveProperty, updateRequest, updateVisit,
} from "@/lib/db";
import { syncTransition } from "@/lib/crm-sync";
import { addDaysKey, dayKey, formatKey, longDate, startOfWeekKey, timeRange, todayKey, weekdayOfKey } from "@/lib/format";
import { esc, p, sendEmail, shell, teamRecipients } from "@/lib/mail";
import { portalOrigin } from "@/lib/portal";
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

/** The people who go out to measure: office staff, or the owner if there are none. */
export function assessorIds(): string[] {
  const staff = db().staff.filter((s) => s.active);
  const office = staff.filter((s) => s.role === "office").map((s) => s.id);
  if (office.length) return office;
  return staff.filter((s) => s.role === "owner").map((s) => s.id);
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
function scheduleHref(iso: string): string {
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
  const busy = db().visits.filter(
    (v) => ACTIVE_VISIT.has(v.status) && v.scheduledStart && v.assignedTo.some((id) => assessors.includes(id))
  );
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
  await ensureData();

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
    await ensureData();
    property = propertyFor(realId);
  }

  const request = await openRequestFor(realId, input.notes);
  const staffId = assessorIds()[0];
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
  void notifyBooking(realId, input.startISO, endISO, property?.address, audit.ip);
  invalidate();
  return { ok: true, message: `Booked for ${longDate(input.startISO)}, ${timeRange(input.startISO, endISO)}.`, visitId };
}

export async function cancelAssessment(clientId: string, visitId: string): Promise<{ ok: boolean; message: string }> {
  if (!DB_LIVE) return { ok: false, message: "Not available right now." };
  await ensureData();
  const visit = upcomingAssessment(clientId);
  if (!visit || visit.id !== visitId) return { ok: false, message: "That booking is no longer on the calendar." };
  if (!["scheduled", "confirmed"].includes(visit.status)) {
    return { ok: false, message: "Our team is already on the way. Please call us to change it." };
  }
  await updateVisit(visit.id, { status: "cancelled" });

  const client = getClient(clientId);
  const [to, ...cc] = teamRecipients();
  void sendEmail({
    to,
    cc,
    subject: `Assessment cancelled by customer: ${client?.name ?? clientId}`,
    html: shell({
      heading: "A customer cancelled their assessment",
      body: p(`${esc(client?.name ?? "A customer")} cancelled the on-site assessment that was booked for ${esc(longDate(visit.scheduledStart))}, ${esc(timeRange(visit.scheduledStart, visit.scheduledEnd))}. They can rebook from their portal, or you can reach them to reschedule.`),
      cta: { label: "Open the schedule", href: scheduleHref(visit.scheduledStart) },
    }),
  });
  return { ok: true, message: "Cancelled. Pick a new time whenever you are ready." };
}

/** The request the visit hangs off: the newest open one, or a fresh one when the client has none. */
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
  await ensureData();
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
        p("It is on the Schedule now, assigned to the office. The 24-hour reminder goes out automatically."),
      cta: { label: "Open the schedule", href: scheduleHref(startISO) },
    }),
  });

  if (client.email) {
    await sendEmail({
      to: client.email,
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
