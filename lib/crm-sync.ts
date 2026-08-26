import "server-only";
import { hsPatch, hsNote, dealIdForContact } from "@/lib/hubspot";
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

  let effects: string[];
  try {
    effects = await effectsFor(transition);
  } catch (err) {
    console.warn("[crm-sync] could not read effects", transition, err);
    return;
  }

  const stageEffect = effects.find((e) => e.startsWith("hubspot.deal."));
  const wantsNote = effects.includes("hubspot.note.agreement");
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
