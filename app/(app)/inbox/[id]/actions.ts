"use server";

import { revalidatePath } from "next/cache";
import { clientOn, getConversation, markRead, recordOutbound } from "@/lib/comms";
import { smsGate } from "@/lib/db";
import { TELNYX_LIVE, sendSms } from "@/lib/telnyx";

export async function sendReplyAction(
  conversationId: string,
  body: string
): Promise<{ ok: boolean; message: string }> {
  const text = body.trim();
  if (!text) return { ok: false, message: "Nothing to send." };

  const conv = await getConversation(conversationId);
  if (!conv) return { ok: false, message: "That thread no longer exists." };
  if (conv.channel !== "sms") return { ok: false, message: "Email replies aren't wired up yet." };

  const client = await clientOn(conv);
  const gate = smsGate(client, "reply");
  if (!gate.ok) return { ok: false, message: gate.reason! };

  if (!TELNYX_LIVE) {
    return { ok: false, message: "Telnyx isn't configured. Set TELNYX_API_KEY and TELNYX_FROM." };
  }

  const res = await sendSms(conv.externalAddress, text);
  if (!res.ok) return { ok: false, message: res.error };

  await recordOutbound({
    conversationId,
    clientId: conv.clientId,
    to: conv.externalAddress,
    body: text,
    providerId: res.id,
  });
  await markRead(conversationId);

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true, message: "Sent." };
}
