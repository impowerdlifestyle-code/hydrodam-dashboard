import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { clientName } from "@/lib/db";
import { phoneDisplay } from "@/lib/format";
import { phoneKey, sendSms, TELNYX_LIVE, toE164 } from "@/lib/telnyx";

/**
 * A text to the office whenever a customer texts in, so nobody has to sit on
 * the Inbox. Numbers come from STAFF_ALERT_PHONES (comma-separated), not code.
 *
 * Sent straight through Telnyx and never recorded as a customer message, so
 * alerts don't show up in anyone's thread. Two guards:
 *  - a text FROM a staff number never alerts, or Emma replying to an alert
 *    would alert Emma, forever;
 *  - one alert per burst: if the same thread had an inbound in the last
 *    10 minutes, that earlier message already alerted.
 */
const BURST_MS = 10 * 60 * 1000;
const APP_URL = "https://hydrodam-dashboard.vercel.app";

function staffPhones(): string[] {
  return (process.env.STAFF_ALERT_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isStaffPhone(phone: string): boolean {
  const key = phoneKey(phone);
  return staffPhones().some((p) => phoneKey(p) === key);
}

async function partOfBurst(conversationId: string): Promise<boolean> {
  if (!SUPABASE_LIVE) return false;
  const rows = await pg.select<{ sent_at: string }>("messages", {
    select: "sent_at",
    conversation_id: `eq.${conversationId}`,
    direction: "eq.inbound",
    order: "sent_at.desc",
    limit: "2",
  });
  const previous = rows[1]?.sent_at;
  return previous !== undefined && Date.now() - Date.parse(previous) < BURST_MS;
}

async function senderName(clientId: string, from: string): Promise<string> {
  if (clientId && SUPABASE_LIVE) {
    const [c] = await pg.select<{ display_name: string | null }>("clients", {
      select: "display_name",
      id: `eq.${clientId}`,
      limit: "1",
    });
    const name = c?.display_name?.trim();
    if (name && phoneKey(name) !== phoneKey(from)) return name;
  } else if (clientId) {
    const name = clientName(clientId);
    if (name !== "Unknown client") return name;
  }
  return phoneDisplay(from);
}

export async function alertStaffOfInbound(opts: {
  from: string;
  body: string;
  clientId: string;
  conversationId: string;
  keyword?: string | null;
}): Promise<void> {
  const to = staffPhones();
  if (!to.length || !TELNYX_LIVE || isStaffPhone(opts.from)) return;

  try {
    if (await partOfBurst(opts.conversationId)) return;

    const who = await senderName(opts.clientId, opts.from);
    const text = opts.body.replace(/\s+/g, " ").trim();
    const said =
      opts.keyword === "stop"
        ? "replied STOP and is now opted out of texts."
        : `texted: "${text.length > 90 ? `${text.slice(0, 87)}...` : text}"`;
    const link = opts.clientId ? `${APP_URL}/texts/${opts.clientId}` : `${APP_URL}/inbox/${opts.conversationId}`;
    const alert = `HydroDam: ${who} ${said} Open: ${link}`;

    await Promise.all(
      to.map(async (phone) => {
        const result = await sendSms(toE164(phone), alert);
        if (!result.ok) console.error("[staff-alert] send failed:", result.error);
      })
    );
  } catch (err) {
    // An alert failing must never fail the webhook, or Telnyx retries the inbound.
    console.error("[staff-alert] failed:", err);
  }
}
