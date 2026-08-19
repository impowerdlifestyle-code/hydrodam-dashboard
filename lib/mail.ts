import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";

/**
 * Email, through Resend's REST API over fetch.
 *
 * No SDK, for the same reason lib/supabase.ts and lib/telnyx.ts have none: this
 * sends one shape of request and the dependency would only add a version to
 * keep current.
 *
 * `thehydrodam.com` is verified in Resend (DKIM, plus the `send` MX and SPF),
 * so customer-facing mail leaves from the company's own domain rather than a
 * shared sender.
 */

export const MAIL_LIVE = Boolean(process.env.RESEND_API_KEY);

const FROM = process.env.MAIL_FROM ?? "HydroDam <info@thehydrodam.com>";
const REPLY_TO = process.env.MAIL_REPLY_TO ?? "info@thehydrodam.com";

/** Emma books the assessments, so internal alerts are addressed to her. */
export const teamRecipients = (): string[] =>
  (process.env.LEAD_NOTIFY_TO ?? "emma.scribner@thehydrodam.com,info@thehydrodam.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export type MailResult = { ok: boolean; id?: string; error?: string };

/**
 * A hard bounce or a complaint is a permanent instruction, not a transient
 * failure. Sending to a suppressed address risks the sending domain's
 * reputation for every other customer, so nothing checks this optionally.
 */
export async function isSuppressed(address: string): Promise<boolean> {
  if (!SUPABASE_LIVE) return false;
  const [row] = await pg.select<{ id: string }>("suppressions", {
    select: "id",
    channel: "eq.email",
    address: `eq.${address.toLowerCase()}`,
    released_at: "is.null",
    limit: "1",
  });
  return Boolean(row);
}

export async function suppress(address: string, reason: string, messageId?: string): Promise<void> {
  if (!SUPABASE_LIVE) return;
  const company = await pg.rpc<string>("company_id", {});
  await pg.insert(
    "suppressions",
    {
      company_id: company,
      channel: "email",
      address: address.toLowerCase(),
      reason,
      source_message_id: messageId ?? null,
    },
    { onConflict: "company_id,channel,address" }
  );
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
  cc?: string[];
}): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set." };

  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  if (to.length === 1 && (await isSuppressed(to[0]))) {
    return { ok: false, error: "This address is suppressed." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: opts.from ?? FROM,
        to,
        cc: opts.cc,
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo ?? REPLY_TO,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await res.json()) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: body.message ?? `Resend ${res.status}` };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------------------------- shell

const NAVY = "#0a1b2e";
const TEAL = "#1f8ab3";
const INK = "#1a2b3c";
const DIM = "#5a6b7c";
const LINE = "#e2e8ee";

/**
 * The house shell for customer mail, table-based and inline-styled because
 * Gmail strips a `<style>` block and Outlook ignores most of what survives.
 * HydroDam's own navy and teal — this is the client's mail, not Voreli's.
 */
export function shell(opts: { heading: string; body: string; cta?: { label: string; href: string } }): string {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 32px 0">
         <a href="${opts.cta.href}" style="display:inline-block;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px">${opts.cta.label}</a>
       </td></tr>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fa;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
      <tr><td style="background:${NAVY};padding:20px 32px">
        <span style="color:#ffffff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:19px;font-weight:700;letter-spacing:-0.2px">Hydro<span style="color:${TEAL}">Dam</span></span>
      </td></tr>
      <tr><td style="padding:30px 32px 0">
        <h1 style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:21px;line-height:1.3;color:${INK};font-weight:700">${opts.heading}</h1>
      </td></tr>
      <tr><td style="padding:14px 32px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.62;color:${INK}">
        ${opts.body}
      </td></tr>
      ${cta}
      <tr><td style="padding:28px 32px 30px">
        <div style="border-top:1px solid ${LINE};padding-top:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;line-height:1.6;color:${DIM}">
          Hydro Dam, LLC · 6140 Ulmerton Rd, Clearwater, FL · (727) 613-1415<br>
          <a href="https://thehydrodam.com" style="color:${TEAL};text-decoration:none">thehydrodam.com</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export const p = (text: string): string =>
  `<p style="margin:0 0 14px">${text}</p>`;

export const esc = (s = ""): string =>
  s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
