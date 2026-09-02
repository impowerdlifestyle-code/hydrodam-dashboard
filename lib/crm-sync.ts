import "server-only";
import { hsPatch, hsNote, dealIdForContact, contactLeadStatus } from "@/lib/hubspot";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";

/**
 * Pushing our own status changes back into HubSpot.
 *
 * `status_transitions.effects` has named the intended HubSpot moves since 0001
 * — `hubspot.deal.presentationscheduled`, `.decisionmakerboughtin`,
 * `.contractsent`, `.closedlost`, `hubspot.note.agreement` — and nothing has
 * ever read the column. So Mady's pipeline still shows 149 of 150 deals parked
 * in `appointmentscheduled` while the dashboard knows perfectly well that a
 * quote was sent, approved and turned into a job. This reads that column and
 * does what it says.
 *
 * Two rules keep a sync bug from damaging a CRM we do not own:
 *
 *  - **Forward only.** Stages are ranked, and a deal is never moved backwards
 *    or out of a closed state. A replayed or out-of-order effect is a no-op
 *    rather than a deal dragged back out of Closed Won.
 *  - **Never invent.** If the contact has no deal, nothing is created. Making
 *    deals from here would put rows in Mady's pipeline that no one asked for.
 *
 * Failures are logged and swallowed. HubSpot being down is not a reason to fail
 * the write that already landed in our own database.
 */

const STAGE_ORDER = [
  "appointmentscheduled",
  "qualifiedtobuy",
  "presentationscheduled",
  "decisionmakerboughtin",
  "contractsent",
  "closedwon",
  "closedlost",
] as const;

const CLOSED = new Set(["closedwon", "closedlost"]);

const rank = (stage: string | undefined): number =>
  stage ? STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) : -1;

type Transition = { entity: string; from: string; to: string };

/**
 * The lead status is the pipeline Mady actually works (the deal stages sit
 * untouched at "Appointment Scheduled"), so a dashboard step also sets the
 * contact's hs_lead_status to the portal's own label for that step. Keys are
 * HubSpot's internal values; the comment is what the portal shows.
 */
const LEAD_STATUS_FOR: Record<string, string> = {
  "request:contacted": "ATTEMPTED_TO_CONTACT",          // Attempted to Contact
  "request:assessment_scheduled": "IN_PROGRESS",        // Measurement Scheduled
  "request:assessed": "Itimized Estimate Pending",
  "request:unqualified": "UNQUALIFIED",                 // Declined
  "quote:sent": "CONNECTED",                            // Estimate Created
  "quote:declined": "Declined Itimized Estimate",
  "invoice:paid": "OPEN_DEAL",                          // Invoice Paid
};

const LEAD_ORDER = [
  "NEW", "ATTEMPTED_TO_CONTACT", "Future Follow Up", "BAD_TIMING", "IN_PROGRESS",
  "Awiting Customer Measurements", "OPEN", "Itimized Estimate Pending", "CONNECTED", "OPEN_DEAL",
];
const LEAD_TERMINAL = new Set(["OPEN_DEAL"]);
const LEAD_DECLINED = new Set(["UNQUALIFIED", "Declined Itimized Estimate", "Inadequate Contact Info"]);
const leadRank = (v: string | null): number => (v ? LEAD_ORDER.indexOf(v) : -1);

async function pushLeadStatus(transition: Transition, contactId: string): Promise<void> {
  const target = LEAD_STATUS_FOR[`${transition.entity}:${transition.to}`];
  if (!target) return;
  const current = await contactLeadStatus(contactId);
  if (current === target) return;
  if (current && LEAD_TERMINAL.has(current)) {
    console.warn(`[crm-sync] contact ${contactId} is ${current}; not moving to ${target}`);
    return;
  }
  // A decline can be recorded from any open state. A step forward only ever
  // moves the status forward, so a replayed action cannot drag it back.
  if (!LEAD_DECLINED.has(target) && current && !LEAD_DECLINED.has(current) && leadRank(target) <= leadRank(current)) {
    console.warn(`[crm-sync] contact ${contactId} is already ${current}; ${target} is not forward`);
    return;
  }
  await hsPatch(`/crm/v3/objects/contacts/${contactId}`, { properties: { hs_lead_status: target } });
  console.info(`[crm-sync] contact ${contactId} lead status ${current ?? "none"} -> ${target}`);
}

async function effectsFor({ entity, from, to }: Transition): Promise<string[]> {
  if (!SUPABASE_LIVE) return [];
  const [row] = await pg.select<{ effects: string[] }>("status_transitions", {
    select: "effects",
    entity: `eq.${entity}`,
    from_status: `eq.${from}`,
    to_status: `eq.${to}`,
    limit: "1",
  });
  return row?.effects ?? [];
}

/**
 * @param contactId HubSpot contact id, from `clients.hubspot_contact_id`. A
 *   client that was never a CRM contact simply has nothing to sync.
 */
export async function syncTransition(
  transition: Transition,
  contactId: string | undefined,
  context: { note?: string } = {},
): Promise<void> {
  if (!contactId) return;

  try {
    await pushLeadStatus(transition, contactId);
  } catch (err) {
    console.warn("[crm-sync] lead status push failed", transition, err);
  }

  let effects: string[];
  try {
    effects = await effectsFor(transition);
  } catch (err) {
    console.warn("[crm-sync] could not read effects", transition, err);
    return;
  }

  const stageEffect = effects.find((e) => e.startsWith("hubspot.deal."));
  // Every hubspot.note.* effect means "tell the CRM what just happened"; the
  // suffix only names which event, and the caller supplies the wording.
  const wantsNote = effects.some((e) => e.startsWith("hubspot.note."));
  if (!stageEffect && !wantsNote) return;

  try {
    if (stageEffect) {
      const target = stageEffect.slice("hubspot.deal.".length);
      const deal = await dealIdForContact(contactId);

      if (!deal) {
        console.warn(`[crm-sync] contact ${contactId} has no deal; not creating one for ${target}`);
      } else if (CLOSED.has(deal.stage)) {
        console.warn(`[crm-sync] deal ${deal.id} is ${deal.stage}; refusing to move it to ${target}`);
      } else if (rank(target) <= rank(deal.stage)) {
        console.warn(`[crm-sync] deal ${deal.id} is already ${deal.stage}; ${target} is not forward`);
      } else {
        await hsPatch(`/crm/v3/objects/deals/${deal.id}`, { properties: { dealstage: target } });
        console.info(`[crm-sync] deal ${deal.id} ${deal.stage} -> ${target}`);
      }
    }

    if (wantsNote && context.note) await hsNote(contactId, context.note);
  } catch (err) {
    console.warn("[crm-sync] push failed", transition, err);
  }
}
