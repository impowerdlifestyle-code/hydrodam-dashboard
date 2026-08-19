import "server-only";
import { createPublicKey, verify } from "node:crypto";

/**
 * Telnyx messaging — HydroDam's own Telnyx account (not the Yacht Away Now one).
 *
 *   number   +1 727-351-8152
 *   profile  "Hydrodam sms" (API v2)
 *
 * Outbound is a plain POST to /v2/messages; inbound arrives as a webhook signed
 * with the account's Ed25519 public key. No SDK — the two calls we make are
 * smaller than the dependency.
 */

const MESSAGES_URL = "https://api.telnyx.com/v2/messages";

export const TELNYX_LIVE = Boolean(
  process.env.TELNYX_API_KEY && (process.env.TELNYX_FROM || process.env.TELNYX_MESSAGING_PROFILE_ID)
);

export const telnyxStatus = () => ({
  live: TELNYX_LIVE,
  from: process.env.TELNYX_FROM,
  signed: Boolean(process.env.TELNYX_PUBLIC_KEY),
});

export function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Last ten digits, so "(727) 555-0134" and "+17275550134" compare equal. */
export function phoneKey(raw?: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(-10);
}

/** GSM-7 segments to 160 chars, and any non-GSM character drops the whole message to 70. */
export function segmentsFor(text: string): { chars: number; segments: number; unicode: boolean } {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const per = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const chars = text.length;
  const segments = chars === 0 ? 0 : chars <= per ? 1 : Math.ceil(chars / multi);
  return { chars, segments, unicode };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendSms(to: string, text: string): Promise<SendResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return { ok: false, error: "TELNYX_API_KEY is not set." };

  const payload: Record<string, string> = { to: toE164(to), text };
  if (process.env.TELNYX_FROM) payload.from = process.env.TELNYX_FROM;
  else payload.messaging_profile_id = process.env.TELNYX_MESSAGING_PROFILE_ID!;

  let res: Response;
  try {
    res = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Could not reach Telnyx." };
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: { id?: string }; errors?: { detail?: string; title?: string }[] }
    | null;

  if (!res.ok) {
    const err = body?.errors?.[0];
    return { ok: false, error: err?.detail ?? err?.title ?? `Telnyx returned ${res.status}.` };
  }
  return { ok: true, id: body?.data?.id ?? "" };
}

// ------------------------------------------------------------ webhook proof

// Telnyx signs `${timestamp}|${rawBody}` with Ed25519. Node wants an SPKI key,
// so the 32 raw bytes from the portal get the standard Ed25519 DER prefix.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TOLERANCE_SECONDS = 300;

export function verifyWebhook(rawBody: string, signature?: string | null, timestamp?: string | null): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey) return false;
  if (!signature || !timestamp) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- keywords

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes", "optin"]);

export type Keyword = "stop" | "start" | "help" | null;

export function keywordIn(text: string): Keyword {
  const word = text.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (word === "help" || word === "info") return "help";
  return null;
}
