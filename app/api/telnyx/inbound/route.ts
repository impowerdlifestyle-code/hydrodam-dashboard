import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  applyDeliveryReceipt,
  findClientByPhone,
  recordInboundSms,
  setSmsConsent,
} from "@/lib/db";
import { keywordIn, sendSms, verifyWebhook } from "@/lib/telnyx";

/**
 * Telnyx webhook — set as the Inbound URL on the "Hydrodam sms" messaging
 * profile. It carries both halves of the conversation: messages customers send
 * us, and delivery receipts for the ones we sent them.
 *
 * Signature checking is mandatory. Anyone who learns this URL could otherwise
 * write messages into the Inbox, so an unsigned request is refused outright
 * rather than trusted "for now".
 */

type Payload = {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      direction?: "inbound" | "outbound";
      text?: string;
      received_at?: string;
      from?: { phone_number?: string };
      to?: { phone_number?: string; status?: string }[];
      errors?: { detail?: string; title?: string }[];
    };
  };
};

const DELIVERY: Record<string, "sent" | "delivered" | "failed"> = {
  queued: "sent",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  delivery_failed: "failed",
  delivery_unconfirmed: "sent",
  sending_failed: "failed",
};

const HELP_REPLY =
  "HydroDam flood barriers. Call (727) 613-1415 or reply here and a person will answer. Reply STOP to opt out.";

export async function POST(req: Request) {
  const raw = await req.text();

  if (
    !verifyWebhook(
      raw,
      req.headers.get("telnyx-signature-ed25519"),
      req.headers.get("telnyx-timestamp")
    )
  ) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as Payload;
  const type = event.data?.event_type;
  const p = event.data?.payload;
  if (!p) return NextResponse.json({ ok: true });

  if (type === "message.received" && p.direction === "inbound") {
    const from = p.from?.phone_number;
    const body = p.text ?? "";
    if (!from) return NextResponse.json({ ok: true });

    const { conversation } = recordInboundSms({
      from,
      body,
      receivedAt: p.received_at,
      providerId: p.id,
    });

    // Telnyx blocks further sends after STOP on its side. Mirroring it here is
    // what stops the Inbox from offering a reply box that would silently fail.
    const keyword = keywordIn(body);
    const client = findClientByPhone(from);
    if (keyword === "stop" && client) setSmsConsent(client.id, false);
    if (keyword === "start" && client) setSmsConsent(client.id, true);
    if (keyword === "help") await sendSms(from, HELP_REPLY);

    revalidatePath("/inbox");
    revalidatePath(`/inbox/${conversation.id}`);
    return NextResponse.json({ ok: true });
  }

  if (type === "message.sent" || type === "message.finalized") {
    const status = DELIVERY[p.to?.[0]?.status ?? ""] ?? undefined;
    if (p.id && status) {
      const err = p.errors?.[0];
      applyDeliveryReceipt(p.id, status, err?.detail ?? err?.title);
      revalidatePath("/inbox");
    }
  }

  return NextResponse.json({ ok: true });
}
