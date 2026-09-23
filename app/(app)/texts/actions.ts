"use server";

import { revalidatePath } from "next/cache";
import { withOptOut } from "@/lib/campaigns";
import { textClient } from "@/lib/comms";
import { ensureData, getClient, smsGate } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { decideDraft, getDraft, kindOf } from "@/lib/sms-copilot";

type Result = { ok: boolean; message: string };

const REFUSALS: Record<string, string> = {
  no_db: "No database is configured on this deployment, so nothing can be sent or logged.",
  no_sms_key: "Telnyx isn't configured. Set TELNYX_API_KEY and TELNYX_FROM.",
  no_10dlc_registration: "Carrier registration isn't marked complete (SMS_CARRIER_READY), so texts are held.",
  no_consent: "No consent on file for this kind of text, so it was not sent.",
  opted_out: "This client opted out. Nothing was sent.",
  quiet_hours: "Outside quiet hours (8am to 9pm Eastern). Nothing was sent; try again in the morning.",
  already_sent: "This draft has already been sent.",
};

function refresh(clientId: string) {
  revalidatePath("/texts");
  revalidatePath(`/texts/${clientId}`);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/inbox");
}

/**
 * Sends an approved draft. The client-level gate runs first so the office sees
 * the same reason the page already showed; `textClient` then re-checks consent
 * against the ledger, quiet hours and the carrier route, and reserves a
 * message_sends row so a double-click cannot text anyone twice. The draft is
 * only marked sent once the provider accepted it.
 */
export async function sendDraftAction(draftId: string, pageClientId: string, text: string): Promise<Result> {
  await requireSession();
  await ensureData();
  const body = text.trim();
  if (!body) return { ok: false, message: "Nothing to send." };

  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, message: "That draft no longer exists." };
  if (draft.action !== "pending") return { ok: false, message: "This draft was already decided." };

  const kind = kindOf(draft.kind)!;
  const client = getClient(draft.clientId);
  const gate = smsGate(client, kind.marketing ? "marketing" : "transactional");
  if (!gate.ok || !client?.phone) return { ok: false, message: gate.reason ?? "No mobile number on this client." };

  const res = await textClient({
    clientId: draft.clientId,
    phone: client.phone,
    body: kind.marketing ? withOptOut(body) : body,
    templateKey: `copilot_${draft.kind}`,
    consent: kind.marketing ? "sms_marketing" : "sms_transactional",
    dedupeKey: `sms_copilot:${draft.id}`,
  });
  if (!res.sent) return { ok: false, message: REFUSALS[res.reason ?? ""] ?? res.reason ?? "Not sent." };

  await decideDraft(draft.id, {
    action: body === draft.draftText ? "sent_as_is" : "sent_edited",
    finalText: body,
    messageId: res.messageId,
  });
  refresh(pageClientId);
  return { ok: true, message: "Sent." };
}

export async function rejectDraftAction(draftId: string, pageClientId: string, reason: string): Promise<Result> {
  await requireSession();
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, message: "That draft no longer exists." };
  if (draft.action !== "pending") return { ok: false, message: "This draft was already decided." };
  await decideDraft(draft.id, { action: "rejected", rejectReason: reason.trim().slice(0, 500) || undefined });
  refresh(pageClientId);
  return { ok: true, message: "Rejected. The next draft will steer away from it." };
}
