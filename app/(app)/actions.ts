"use server";

import { revalidatePath } from "next/cache";
import { AGREEMENT_VERSION, ESIGN_CONSENT } from "@/lib/agreement";
import {
  DB_LIVE, addTeammate, approveQuote, clockIn, clockOut, convertQuoteToJob, createInvoice,
  addOpening, createQuote, createVisit, ensureData, getJob, getQuote, getRequest, getVisit,
  moveVisit, openingsFor, realRequestId, recordPayment, removeOpening, saveChecklist, saveProperty,
  setTeammateActive, toggleAutomation, updateInvoice, updateJob, updateQuote, updateRequest,
  updateVisit,
} from "@/lib/db";
import { specFor } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import type {
  InvoiceKind, JobStatus, OpeningType, PaymentMethod, RequestStatus, Role, Series, VisitKind,
  VisitStatus,
} from "@/lib/types";

/**
 * Every write the office and field UI can perform.
 *
 * One dispatcher rather than forty exported functions: the controls are small
 * and repetitive (a select, a button, a two-field form), and a discriminated
 * union keeps them type-checked at both ends while the client bundle stays a
 * single generic component. The union is the list of things this app can do.
 */

export type OpsInput =
  | { kind: "request.status"; id: string; status: RequestStatus }
  | { kind: "request.assign"; id: string; userId: string }
  | { kind: "request.schedule"; id: string; startISO: string; minutes: number; staffIds: string[] }
  | { kind: "request.quote"; id: string; series: Series }
  | { kind: "quote.send"; id: string }
  | { kind: "quote.decline"; id: string }
  | { kind: "quote.approve"; id: string; signerName: string }
  | { kind: "quote.job"; id: string }
  | { kind: "job.status"; id: string; status: JobStatus }
  | { kind: "job.fabrication"; id: string; stage: string }
  | { kind: "job.visit"; id: string; visitKind: VisitKind; startISO: string; minutes: number; staffIds: string[] }
  | { kind: "job.invoice"; id: string; invoiceKind: InvoiceKind }
  | { kind: "visit.status"; id: string; status: VisitStatus }
  | { kind: "visit.move"; id: string; startISO: string; staffIds?: string[] }
  | { kind: "visit.notes"; id: string; notes: string }
  | { kind: "invoice.send"; id: string }
  | { kind: "invoice.void"; id: string }
  | { kind: "invoice.pay"; id: string; amountCents: number; method: PaymentMethod; reference?: string }
  | { kind: "automation.toggle"; id: string; armed: boolean }
  | { kind: "team.add"; name: string; email: string; phone?: string; role: Role; hourlyCents: number }
  | { kind: "team.active"; id: string; active: boolean }
  | { kind: "clock.in"; userId: string; jobId?: string; visitId?: string }
  | { kind: "clock.out"; userId: string }
  | { kind: "checklist.save"; visitId: string; answers: Record<string, string>; submit: boolean }
  | {
      kind: "property.save"; clientId: string; label?: string; address: string; city: string;
      postalCode: string; floodZone?: string; accessNotes?: string;
    }
  | {
      kind: "opening.add"; propertyId: string; label: string; type: OpeningType;
      widthIn: number; protectionHeightIn: number; surface?: string;
    }
  | { kind: "opening.remove"; id: string };

export type OpsResult = { ok: boolean; message: string; href?: string };

const NEEDS_DB = "Connect Supabase first — this writes to the database.";

export async function runOps(input: OpsInput): Promise<OpsResult> {
  await requireSession();
  await ensureData();

  try {
    const result = await dispatch(input);
    revalidateEverything();
    return result;
  } catch (err) {
    return { ok: false, message: humanise(err) };
  }
}

/**
 * The database refuses illegal moves rather than trusting the UI to hide them,
 * so its errors are the ones a user sees. They arrive wrapped in PostgREST's
 * JSON envelope; this pulls out the sentence a person can act on.
 */
function humanise(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/"message":"([^"]+)"/);
  const message = match ? match[1].replace(/\\"/g, '"') : raw;

  if (/a visit needs a client and a property on file/.test(message)) {
    return "Add the service address to this client first — a visit has to have somewhere to go.";
  }
  if (/already assigned to overlapping visit/.test(message)) {
    return "That crew member is already booked over this window.";
  }
  if (/cannot be completed without a submitted QA checklist/.test(message)) {
    return "The QA checklist has to be signed off before this job can complete.";
  }
  if (/cannot be approved without a recorded signature/.test(message)) {
    return "A quote needs a recorded signature before it can be approved.";
  }
  if (/missing required fields/.test(message)) {
    return "Some required checklist answers are still blank.";
  }
  if (/answers must be keyed by field id/.test(message)) {
    return "That checklist submission was keyed by question text, not field id.";
  }
  const transition = message.match(/^(\w+) cannot move from (\w+) to (\w+)$/);
  if (transition) {
    return `A ${transition[1]} cannot go from ${transition[2].replace(/_/g, " ")} to ${transition[3].replace(/_/g, " ")}.`;
  }
  return message;
}

function revalidateEverything(): void {
  for (const path of ["/", "/requests", "/quotes", "/jobs", "/schedule", "/invoices", "/clients", "/team", "/automations", "/reports", "/field"]) {
    revalidatePath(path, "layout");
  }
}

async function dispatch(input: OpsInput): Promise<OpsResult> {
  switch (input.kind) {
    // ------------------------------------------------------------ requests

    case "request.status": {
      const { requestId } = await realRequestId(input.id);
      // The first time anyone moves a lead off `new`, that IS the first
      // response. The Requests screen reports speed to lead off this.
      const patch: Parameters<typeof updateRequest>[1] = { status: input.status };
      if (!getRequest(input.id)?.firstResponseAt && input.status !== "new") {
        patch.firstResponseAt = new Date().toISOString();
      }
      await updateRequest(requestId, patch);
      return { ok: true, message: `Moved to ${input.status.replace(/_/g, " ")}.` };
    }

    case "request.assign": {
      const { requestId } = await realRequestId(input.id);
      await updateRequest(requestId, { assignedTo: input.userId });
      return { ok: true, message: input.userId ? "Assigned." : "Unassigned." };
    }

    case "request.schedule": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      const { requestId } = await realRequestId(input.id);
      await createVisit({
        requestId,
        kind: "assessment",
        title: "On-site assessment",
        startISO: input.startISO,
        minutes: input.minutes,
        staffIds: input.staffIds,
      });
      return { ok: true, message: "Assessment booked." };
    }

    case "request.quote": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      const req = getRequest(input.id);
      if (!req) return { ok: false, message: "That request no longer exists." };

      const { requestId, clientId, propertyId } = await realRequestId(input.id);
      if (!propertyId) {
        return { ok: false, message: "Add a service address to this client before quoting." };
      }

      const specs = openingsFor(propertyId).map((o) => specFor(o, input.series));
      if (specs.length === 0) {
        return { ok: false, message: "No openings on file at this property yet — measure it first." };
      }

      const id = await createQuote({
        clientId,
        propertyId,
        requestId,
        title: `${input.series[0].toUpperCase()}${input.series.slice(1)} — ${specs.length} opening${specs.length === 1 ? "" : "s"}`,
        series: input.series,
        specs,
      });
      return { ok: true, message: "Quote drafted.", href: `/quotes/${id}` };
    }

    // -------------------------------------------------------------- quotes

    case "quote.send":
      await updateQuote(input.id, { status: "sent" });
      return { ok: true, message: "Marked as sent." };

    case "quote.decline":
      await updateQuote(input.id, { status: "declined" });
      return { ok: true, message: "Marked declined." };

    case "quote.approve": {
      const name = input.signerName.trim();
      if (name.length < 2) return { ok: false, message: "Who approved it? A signer name is required." };
      await approveQuote(input.id, name, "", "HydroDam Ops (office)", AGREEMENT_VERSION, ESIGN_CONSENT);
      return { ok: true, message: `Approved and signed by ${name}.` };
    }

    case "quote.job": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      const id = await convertQuoteToJob(input.id);
      const number = getQuote(input.id)?.number;
      return { ok: true, message: `Quote #${number} is now a job.`, href: `/jobs/${id}` };
    }

    // ---------------------------------------------------------------- jobs

    case "job.status":
      await updateJob(input.id, { status: input.status });
      return { ok: true, message: `Job is ${input.status.replace(/_/g, " ")}.` };

    case "job.fabrication":
      await updateJob(input.id, { fabricationStatus: input.stage as never });
      return { ok: true, message: `Fabrication: ${input.stage.replace(/_/g, " ")}.` };

    case "job.visit": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      const job = getJob(input.id);
      await createVisit({
        jobId: input.id,
        kind: input.visitKind,
        title: `${input.visitKind.replace(/_/g, " ")} — ${job?.title ?? "job"}`,
        startISO: input.startISO,
        minutes: input.minutes,
        staffIds: input.staffIds,
      });
      return { ok: true, message: "Visit added to the schedule." };
    }

    case "job.invoice": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      const id = await createInvoice(input.id, input.invoiceKind);
      return { ok: true, message: "Invoice raised.", href: `/invoices/${id}` };
    }

    // -------------------------------------------------------------- visits

    case "visit.status": {
      const patch: Parameters<typeof updateVisit>[1] = { status: input.status };
      const now = new Date().toISOString();
      if (input.status === "en_route") patch.enRouteAt = now;
      if (input.status === "in_progress") patch.checkedInAt = now;
      if (input.status === "completed") patch.completedAt = now;
      await updateVisit(input.id, patch);
      return { ok: true, message: `Visit ${input.status.replace(/_/g, " ")}.` };
    }

    case "visit.move":
      await moveVisit(input.id, input.startISO, input.staffIds);
      return { ok: true, message: "Rescheduled." };

    case "visit.notes":
      await updateVisit(input.id, { crewNotes: input.notes });
      return { ok: true, message: "Notes saved." };

    // ------------------------------------------------------------ invoices

    case "invoice.send":
      await updateInvoice(input.id, { status: "sent" });
      return { ok: true, message: "Marked as sent." };

    case "invoice.void":
      await updateInvoice(input.id, { status: "void" });
      return { ok: true, message: "Voided." };

    case "invoice.pay": {
      if (input.amountCents <= 0) return { ok: false, message: "Enter an amount." };
      await recordPayment(input.id, input.amountCents, input.method, input.reference);
      return {
        ok: true,
        message:
          input.method === "ach"
            ? "ACH recorded as processing — it clears in 3–5 business days."
            : "Payment recorded.",
      };
    }

    // ---------------------------------------------------------- automations

    case "automation.toggle":
      await toggleAutomation(input.id, input.armed);
      return {
        ok: true,
        message: input.armed
          ? "Armed. The epoch is stamped now, so nothing older than this moment is eligible."
          : "Disarmed. Runs are dry from here.",
      };

    // ---------------------------------------------------------------- team

    case "team.add": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      if (!input.name.trim() || !input.email.trim()) return { ok: false, message: "Name and email are required." };
      await addTeammate({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim(),
        role: input.role,
        costRateCentsPerHour: input.hourlyCents,
      });
      return { ok: true, message: `${input.name.trim()} added.` };
    }

    case "team.active":
      await setTeammateActive(input.id, input.active);
      return { ok: true, message: input.active ? "Reactivated." : "Deactivated." };

    // --------------------------------------------------------------- clock

    case "clock.in":
      await clockIn(input.userId, input.jobId, input.visitId);
      return { ok: true, message: "Clocked in." };

    case "clock.out":
      await clockOut(input.userId);
      return { ok: true, message: "Clocked out." };

    // ------------------------------------------------- property + openings

    case "property.save": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      if (!input.address.trim() || !input.city.trim() || !input.postalCode.trim()) {
        return { ok: false, message: "Street, city and ZIP are all needed." };
      }
      await saveProperty(input.clientId, {
        label: input.label,
        address: input.address.trim(),
        city: input.city.trim(),
        postalCode: input.postalCode.trim(),
        floodZone: input.floodZone,
        accessNotes: input.accessNotes,
      });
      return { ok: true, message: "Address saved." };
    }

    case "opening.add": {
      if (!DB_LIVE) return { ok: false, message: NEEDS_DB };
      if (!input.label.trim()) return { ok: false, message: "Name the opening." };
      if (!(input.widthIn > 0) || !(input.protectionHeightIn > 0)) {
        return { ok: false, message: "Width and protection height are both needed, in inches." };
      }
      await addOpening(input.propertyId, {
        label: input.label.trim(),
        type: input.type,
        widthIn: input.widthIn,
        protectionHeightIn: input.protectionHeightIn,
        surface: input.surface,
      });
      return { ok: true, message: "Opening added." };
    }

    case "opening.remove":
      await removeOpening(input.id);
      return { ok: true, message: "Opening removed." };

    // ----------------------------------------------------------- checklist

    case "checklist.save": {
      const visit = getVisit(input.visitId);
      if (!visit) return { ok: false, message: "That visit no longer exists." };
      const installer = (input.answers.installer ?? "").trim();
      if (input.submit && !installer) {
        return { ok: false, message: "Installer name is required to sign off." };
      }
      await saveChecklist(visit.jobId, input.visitId, input.answers, input.submit, installer || "Crew");
      return { ok: true, message: input.submit ? "Installation signed off." : "Progress saved." };
    }
  }
}
