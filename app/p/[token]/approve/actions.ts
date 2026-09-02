"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AGREEMENT_VERSION, ESIGN_CONSENT, SMS_CONSENT } from "@/lib/agreement";
import { toE164 } from "@/lib/telnyx";
import { DB_LIVE, ensureData, getClient, getQuote, invalidate, isApprovable } from "@/lib/db";
import { syncTransition } from "@/lib/crm-sync";
import { resolvePortalToken } from "@/lib/portal";
import * as pg from "@/lib/supabase";

/**
 * The customer approving their own quote.
 *
 * This is the one write in the app performed by someone who is not signed in,
 * so the authorization is the portal token and it is checked here rather than
 * anywhere upstream: the token resolves to exactly one client, and the quote
 * has to belong to that client. A token for Jan cannot approve Peter's quote
 * even if the quote id is known.
 *
 * The signature is what makes the approval legal, and 0001 refuses `approved`
 * without one — so both happen in a single transaction, stamped with the real
 * IP, user agent and the verbatim consent text the customer was shown.
 */
export async function approveFromPortal(
  token: string,
  quoteId: string,
  signerName: string,
  consented: boolean,
  textsOk = false
): Promise<{ ok: boolean; message: string }> {
  if (!DB_LIVE) return { ok: false, message: "Not available yet." };

  const name = signerName.trim();
  if (name.length < 2) return { ok: false, message: "Please type your full name." };
  if (!consented) return { ok: false, message: "Please tick the box to sign electronically." };

  const head = await headers();
  const link = await resolvePortalToken(token, {
    ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: head.get("user-agent") ?? undefined,
    path: "/p/approve",
  });
  if (!link) return { ok: false, message: "This link has expired. Ask HydroDam for a new one." };

  await ensureData();
  const quote = getQuote(quoteId);
  if (!quote || quote.clientId !== link.clientId) {
    return { ok: false, message: "That quote isn't on this project." };
  }
  if (["approved", "converted"].includes(quote.status)) {
    return { ok: true, message: "Already approved — thank you." };
  }
  // api_quote_approve promotes a draft to sent rather than refusing it, so the
  // status gate has to live here. A page rendered before the office withdrew a
  // quote must not be able to sign it on its way out.
  if (!isApprovable(quote)) {
    return {
      ok: false,
      message: `This quote is ${quote.status} and can no longer be approved online. Please contact HydroDam.`,
    };
  }

  await pg.rpc("api_quote_approve", {
    p_quote: quoteId,
    p_signer_name: name,
    p_ip: head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
    p_user_agent: head.get("user-agent") ?? "",
    p_agreement_version: AGREEMENT_VERSION,
    p_esign_consent: ESIGN_CONSENT,
  });
  invalidate();

  // The signature page is the one place a paying customer reads and ticks a
  // consent line themselves, so it is the cleanest SMS opt-in we can record.
  const phone = getClient(link.clientId)?.phone;
  if (textsOk && phone) {
    try {
      const [co] = await pg.select<{ company_id: string }>("clients", { select: "company_id", id: `eq.${link.clientId}`, limit: "1" });
      if (co) {
        await pg.insert(
          "consents",
          (["sms_transactional", "sms_marketing"] as const).map((channel) => ({
            company_id: co.company_id,
            client_id: link.clientId,
            phone: toE164(phone),
            channel,
            action: "granted",
            wording: SMS_CONSENT,
            source: "portal_agreement",
            source_url: "/p/approve",
            ip_address: head.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
            user_agent: head.get("user-agent") ?? null,
          }))
        );
      }
    } catch (err) {
      console.warn("[portal] consent record failed", err);
    }
  }

  // The customer signing is exactly the moment Mady's pipeline should move, and
  // it is the one status change no one in the office is present for.
  await syncTransition(
    { entity: "quote", from: quote.status, to: "approved" },
    getClient(link.clientId)?.hubspotContactId,
  );

  revalidatePath(`/p/${token}`);
  revalidatePath("/quotes", "layout");
  return { ok: true, message: "Approved. HydroDam will be in touch to book your installation." };
}
