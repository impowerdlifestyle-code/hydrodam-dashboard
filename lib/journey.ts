import { jobsFor, quotesFor } from "@/lib/db";
import type { Client } from "@/lib/types";

/**
 * Where a client sits on the seven-step journey, from whichever system actually
 * knows.
 *
 * This used to be an inline expression over Supabase quotes and jobs, computed
 * separately on the client page and in the customer portal. A contact that only
 * exists in HubSpot has neither, so all ~3,000 of them rendered at step one
 * regardless of what the CRM said — `UNQUALIFIED`, `Future Follow Up` and a
 * live deal all painted the same stepper.
 *
 * Order of authority: a quote or job in our own database beats the CRM, because
 * it is a thing we did rather than a label someone typed. Only when there is no
 * such record do we fall back to HubSpot's lead status and deal stage.
 */
export type Journey = {
  /** Index into JOURNEY of the step in progress; earlier steps render done. */
  current: number;
  /** Why it sits there, when the step alone does not say it. */
  caption?: string;
  /** False for a lead the journey does not describe — disqualified, declined. */
  applicable: boolean;
  source: "ops" | "crm";
};

const OUT_OF_JOURNEY = "unqualified";

/** The CRM label read back to a human, rather than our internal enum. */
function crmCaption(client: Client): string | undefined {
  return client.crmStatusLabel ?? client.tags[0];
}

function fromCrm(client: Client): Journey {
  const label = crmCaption(client);

  if (client.crmStatus === OUT_OF_JOURNEY) {
    return { current: 0, applicable: false, caption: label, source: "crm" };
  }

  // A won deal is the one CRM signal that means money was committed, so it
  // outranks the lead status sitting next to it.
  if (client.paid) {
    return client.paid.via === "lead_status_invoice_paid"
      ? { current: 4, applicable: true, caption: "Invoice paid in HubSpot", source: "crm" }
      : { current: 3, applicable: true, caption: "Closed won in HubSpot", source: "crm" };
  }

  switch (client.crmStatus) {
    case "assessed":
      // "Itimized Estimate Pending" means the visit happened and the number is
      // being worked out; "Awiting Customer Measurements" is a step behind it.
      return client.crmStatusLabel === "Awiting Customer Measurements"
        ? { current: 1, applicable: true, caption: label, source: "crm" }
        : { current: 2, applicable: true, caption: label, source: "crm" };
    case "assessment_scheduled":
      return { current: 0, applicable: true, caption: label ?? "Measurement scheduled", source: "crm" };
    case "contacted":
      return { current: 0, applicable: true, caption: `Contacted — ${label}`, source: "crm" };
    default:
      return { current: 0, applicable: true, caption: label ? `${label} — not booked yet` : "Not booked yet", source: "crm" };
  }
}

export function journeyFor(client: Client): Journey {
  const quotes = quotesFor(client.id);
  const jobs = jobsFor(client.id);

  if (!quotes.length && !jobs.length) return fromCrm(client);

  const quote = [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const job = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  let current = 0;
  if (quote && quote.status !== "draft") current = 2;
  if (quote?.status === "approved") current = 3;
  if (quote?.status === "converted") current = 4;
  if (job?.status === "scheduled") current = 5;
  if (job && ["completed", "invoiced", "closed"].includes(job.status)) current = 6;

  return { current, applicable: true, source: "ops" };
}
