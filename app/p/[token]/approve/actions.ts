"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AGREEMENT_VERSION, ESIGN_CONSENT } from "@/lib/agreement";
import { DB_LIVE, ensureData, getQuote, invalidate, isApprovable } from "@/lib/db";
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
  consented: boolean
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

  revalidatePath(`/p/${token}`);
  revalidatePath("/quotes", "layout");
  return { ok: true, message: "Approved. HydroDam will be in touch to book your installation." };
}
