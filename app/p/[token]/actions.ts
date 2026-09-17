"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AGREEMENT_VERSION, ESIGN_CONSENT, SMS_CONSENT } from "@/lib/agreement";
import { bookAssessment, cancelAssessment, type BookInput } from "@/lib/booking";
import { syncTransition } from "@/lib/crm-sync";
import { DB_LIVE, ensureData, getClient, invalidate } from "@/lib/db";
import { esc, p, sendEmail, shell, teamRecipients } from "@/lib/mail";
import { portalOrigin, resolvePortalToken } from "@/lib/portal";
import { qbEstimateById, qbMarkAccepted } from "@/lib/quickbooks";
import * as pg from "@/lib/supabase";
import { toE164 } from "@/lib/telnyx";
import { money } from "@/lib/format";

type Result = { ok: boolean; message: string };

/**
 * Every write from the portal re-resolves the token here, so the customer's
 * credential is checked at the moment of the write and not just when the page
 * was rendered. A token resolves to exactly one client.
 */
async function clientFor(token: string, path: string): Promise<{ clientId: string; ip?: string; userAgent?: string } | null> {
  const head = await headers();
  const ip = head.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = head.get("user-agent") ?? undefined;
  const link = await resolvePortalToken(token, { ip, userAgent, path });
  return link ? { clientId: link.clientId, ip, userAgent } : null;
}

const EXPIRED: Result = { ok: false, message: "This link has expired. Ask HydroDam for a new one." };

export async function bookFromPortal(token: string, input: BookInput): Promise<Result> {
  if (!DB_LIVE) return { ok: false, message: "Not available yet." };
  const who = await clientFor(token, "/p/book");
  if (!who) return EXPIRED;
  const result = await bookAssessment(who.clientId, input, { ip: who.ip });
  if (result.ok) {
    revalidatePath(`/p/${token}`);
    revalidatePath("/schedule", "layout");
    revalidatePath("/requests", "layout");
  }
  return result;
}

export async function cancelBookingFromPortal(token: string, visitId: string): Promise<Result> {
  if (!DB_LIVE) return { ok: false, message: "Not available yet." };
  const who = await clientFor(token, "/p/book/cancel");
  if (!who) return EXPIRED;
  const result = await cancelAssessment(who.clientId, visitId);
  if (result.ok) {
    revalidatePath(`/p/${token}`);
    revalidatePath("/schedule", "layout");
  }
  return result;
}

/**
 * The customer accepting a QuickBooks estimate and signing the warranty and
 * terms in one step. The evidence kept matches the quote signature: typed
 * name, the verbatim consent line, IP, user agent, agreement version, and a
 * hash of the line items they had in front of them. QuickBooks is told
 * afterwards, best-effort; the acceptance here is the record.
 */
export async function acceptEstimateFromPortal(
  token: string,
  estimateId: string,
  signerName: string,
  consented: boolean,
  textsOk = false
): Promise<Result> {
  if (!DB_LIVE) return { ok: false, message: "Not available yet." };
  const name = signerName.trim();
  if (name.length < 2) return { ok: false, message: "Please type your full name." };
  if (!consented) return { ok: false, message: "Please tick the box to sign electronically." };

  const who = await clientFor(token, "/p/estimate/accept");
  if (!who) return EXPIRED;

  await ensureData();
  const client = getClient(who.clientId);
  const estimate = await qbEstimateById(estimateId);
  const ownsIt =
    estimate &&
    (estimate.clientId === who.clientId ||
      (client?.email && estimate.customerEmail?.toLowerCase() === client.email.toLowerCase()));
  if (!estimate || !ownsIt) return { ok: false, message: "That estimate isn't on this project." };
  if (estimate.acceptedAt || estimate.txnStatus === "Accepted") return { ok: true, message: "Already accepted. Thank you." };
  if (["Closed", "Rejected", "Converted"].includes(estimate.txnStatus ?? "")) {
    return { ok: false, message: "This estimate is closed and can no longer be accepted online. Please contact HydroDam." };
  }

  const [existing] = await pg.select<{ id: string }>("portal_acceptances", {
    select: "id", quickbooks_estimate_id: `eq.${estimate.id}`, limit: "1",
  });
  if (existing) return { ok: true, message: "Already accepted. Thank you." };

  const company = await pg.rpc<string>("company_id", {});
  const linesSha = createHash("sha256").update(JSON.stringify(estimate.lines)).digest("hex");
  await pg.insert("portal_acceptances", {
    company_id: company,
    client_id: who.clientId,
    quickbooks_estimate_id: estimate.id,
    signer_name: name,
    ip_address: who.ip || null,
    user_agent: who.userAgent || null,
    agreement_version: AGREEMENT_VERSION,
    esign_consent_text: ESIGN_CONSENT,
    total_cents: estimate.totalCents,
    lines_sha256: linesSha,
  });

  const now = new Date();
  const synced = await qbMarkAccepted(estimate, { name, at: now });
  if (synced) {
    await pg.patch("portal_acceptances", { quickbooks_estimate_id: `eq.${estimate.id}` }, { qb_synced_at: now.toISOString() });
  } else {
    await pg.patch("quickbooks_estimates", { id: `eq.${estimate.id}` }, {
      txn_status: "Accepted", accepted_by: name, accepted_at: now.toISOString(),
    });
  }

  const phone = client?.phone;
  if (textsOk && phone) {
    try {
      await pg.insert(
        "consents",
        (["sms_transactional", "sms_marketing"] as const).map((channel) => ({
          company_id: company,
          client_id: who.clientId,
          phone: toE164(phone),
          channel,
          action: "granted",
          wording: SMS_CONSENT,
          source: "portal_agreement",
          source_url: "/p/estimate",
          ip_address: who.ip || null,
          user_agent: who.userAgent || null,
        }))
      );
    } catch (err) {
      console.warn("[portal] consent record failed", err);
    }
  }

  await syncTransition({ entity: "quote", from: "sent", to: "approved" }, client?.hubspotContactId, {
    note: `Customer accepted QuickBooks estimate ${estimate.docNumber ? `#${estimate.docNumber}` : ""} (${money(estimate.totalCents, true)}) and signed the agreement online.`,
  });

  const [to, ...cc] = teamRecipients();
  void sendEmail({
    to,
    cc,
    subject: `Estimate accepted: ${client?.name ?? "customer"}${estimate.docNumber ? `, #${estimate.docNumber}` : ""} (${money(estimate.totalCents, true)})`,
    replyTo: client?.email,
    html: shell({
      heading: "An estimate was accepted online",
      body:
        p(`<strong>${esc(client?.name ?? "A customer")}</strong> accepted estimate${estimate.docNumber ? ` #${esc(estimate.docNumber)}` : ""} for <strong>${money(estimate.totalCents, true)}</strong> and signed the warranty and terms of sale (agreement ${AGREEMENT_VERSION}).`) +
        p(synced ? "QuickBooks shows it as Accepted." : "QuickBooks could not be updated automatically. Mark the estimate Accepted there when you convert it.") +
        p("Next step: schedule the installation."),
      cta: { label: "Open the client", href: `${portalOrigin()}/clients/${who.clientId}` },
    }),
  });

  invalidate();
  revalidatePath(`/p/${token}`);
  revalidatePath("/clients", "layout");
  return { ok: true, message: "Accepted. HydroDam will be in touch to schedule your installation." };
}
