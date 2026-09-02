"use server";

import { revalidatePath } from "next/cache";
import * as pg from "@/lib/supabase";
import { DB_LIVE, getClient, invalidate, realClientId } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { currentStaff } from "@/lib/whoami";
import { toE164 } from "@/lib/telnyx";

export const CONSENT_SOURCES = {
  phone_call: "Told us on the phone",
  in_person: "Told us in person",
  email_reply: "Said yes by email",
  text_reply: "Said yes by text",
  signed_agreement: "Ticked it on a signed agreement",
} as const;

/**
 * The office writing down a consent the customer gave somewhere we could not
 * capture automatically. The wording is stored verbatim because it is the
 * evidence; marketing consent needs the customer's own written yes, so a
 * phone call can only ever grant transactional.
 */
export async function recordConsentAction(input: {
  clientId: string;
  kind: "transactional" | "marketing";
  source: keyof typeof CONSENT_SOURCES;
  wording: string;
  revoke?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  if (!DB_LIVE) return { ok: false, message: "No database configured." };
  const wording = input.wording.trim();
  if (wording.length < 12) return { ok: false, message: "Write down what they actually agreed to." };
  if (input.kind === "marketing" && ["phone_call", "in_person"].includes(input.source) && !input.revoke) {
    return { ok: false, message: "Marketing texts need a written yes: an email, a text reply or a signed form. Record transactional instead." };
  }

  const { clientId } = await realClientId(input.clientId);
  const client = getClient(clientId) ?? getClient(input.clientId);
  const phone = client?.phone;
  if (!phone) return { ok: false, message: "No mobile number on this client." };

  const [co] = await pg.select<{ company_id: string }>("clients", { select: "company_id", id: `eq.${clientId}`, limit: "1" });
  if (!co) return { ok: false, message: "Client row not found." };
  const who = (await currentStaff())?.name;
  const channels = input.revoke
    ? (["sms_transactional", "sms_marketing"] as const)
    : input.kind === "marketing"
      ? (["sms_transactional", "sms_marketing"] as const)
      : (["sms_transactional"] as const);

  await pg.insert(
    "consents",
    channels.map((channel) => ({
      company_id: co.company_id,
      client_id: clientId,
      phone: toE164(phone),
      channel,
      action: input.revoke ? "revoked" : "granted",
      wording: who ? `${wording} (recorded by ${who})` : wording,
      source: `office:${input.source}`,
    }))
  );
  invalidate();
  revalidatePath(`/clients/${input.clientId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/campaigns");
  return { ok: true, message: input.revoke ? "Opt-out recorded." : input.kind === "marketing" ? "Marketing consent recorded. Campaigns can reach them now." : "Transactional consent recorded. Job updates can be texted; campaigns still cannot." };
}
