import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { applyReceipt, recordInbound, recordKeywordConsent } from "@/lib/comms";
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

// Texting us first is a registered opt-in method, so the first message on a new
// thread gets the carrier-required acknowledgement and a consent record. The
// wording matches the text-in disclosure published beside the number on
// thehydrodam.com/contact-us — that page is the CTA the campaign points at.
const TEXT_IN_REPLY =
  "Thank you for your message to HydroDam! We will be with you shortly. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.";

const TEXT_IN_CONSENT =
  "Texted in to (727) 351-8152, the number published at thehydrodam.com/contact-us with the disclosure: By texting us you agree to receive SMS text messages from HydroDam about your estimate, appointments and service, and occasional marketing or promotional messages. Consent is not a condition of purchase. Message frequency may vary. Standard message and data rates may apply. Reply STOP to opt out, HELP for help.";

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

    const { conversationId, clientId, isNewThread } = await recordInbound({
      from,
      to: p.to?.[0]?.phone_number ?? process.env.TELNYX_FROM ?? "",
      body,
      receivedAt: p.received_at,
      providerId: p.id,
    });

    // Telnyx blocks further sends after STOP on its side. Mirroring it here is
    // what stops the Inbox from offering a reply box that would silently fail,
    // and the ledger is the evidence if the opt-out is ever disputed.
    const keyword = keywordIn(body);
    if (keyword === "stop" || keyword === "start") {
      await recordKeywordConsent({
        phone: from,
        clientId,
        granted: keyword === "start",
        wording: body.trim(),
      });
    }
    if (keyword === "help") await sendSms(from, HELP_REPLY);
    else if (isNewThread && keyword !== "stop") {
      await recordKeywordConsent({ phone: from, clientId, granted: true, wording: TEXT_IN_CONSENT });
      await sendSms(from, TEXT_IN_REPLY);
    }

    revalidatePath("/inbox");
    revalidatePath(`/inbox/${conversationId}`);
    return NextResponse.json({ ok: true });
  }

  if (type === "message.sent" || type === "message.finalized") {
    const status = DELIVERY[p.to?.[0]?.status ?? ""];
    if (p.id && status) {
      const err = p.errors?.[0];
      await applyReceipt(p.id, status, err?.detail ?? err?.title);
      revalidatePath("/inbox");
    }
  }

  return NextResponse.json({ ok: true });
}
