import "server-only";
import { createHash, randomBytes } from "node:crypto";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { db, ensureData, realClientId } from "@/lib/db";
import { p as para, sendEmail, shell } from "@/lib/mail";

/**
 * Client portal links.
 *
 * /p/:token is the one route with no session behind it, so the token IS the
 * credential and it has to behave like one: 256 bits of randomness, stored only
 * as a sha256, never derived from a record id. The previous version resolved
 * `demo-<quoteId>` and bare client ids, which meant anyone holding either
 * identifier — a URL in an email thread, a copied link — could read a
 * customer's project, their quote and their outstanding balance.
 *
 * Every resolution is logged, valid or not, because a public endpoint that
 * hands out customer records should leave a trail of who asked.
 */

const TOKEN_BYTES = 32;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export type PortalLink = {
  clientId: string;
  quoteId?: string;
  jobId?: string;
  invoiceId?: string;
};

type LinkRow = {
  id: string;
  client_id: string;
  quote_id: string | null;
  job_id: string | null;
  invoice_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  use_count: number;
};

/** Returns the token exactly once. It is never recoverable from the database. */
export async function mintPortalLink(opts: {
  clientId: string;
  quoteId?: string;
  jobId?: string;
  invoiceId?: string;
  days?: number;
}): Promise<string | undefined> {
  if (!SUPABASE_LIVE) return undefined;

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const company = await pg.rpc<string>("company_id", {});

  await pg.insert("portal_links", {
    company_id: company,
    token_hash: hash(token),
    client_id: opts.clientId,
    quote_id: opts.quoteId ?? null,
    job_id: opts.jobId ?? null,
    invoice_id: opts.invoiceId ?? null,
    expires_at: new Date(Date.now() + (opts.days ?? 90) * 86_400_000).toISOString(),
  });

  return token;
}

export async function resolvePortalToken(
  token: string,
  audit: { ip?: string; userAgent?: string; path: string }
): Promise<PortalLink | null> {
  if (!SUPABASE_LIVE) return null;

  const tokenHash = hash(token);
  const [row] = await pg.select<LinkRow>("portal_links", {
    select: "id,client_id,quote_id,job_id,invoice_id,expires_at,revoked_at,use_count",
    token_hash: `eq.${tokenHash}`,
    limit: "1",
  });

  const ok = Boolean(
    row &&
      !row.revoked_at &&
      (!row.expires_at || Date.parse(row.expires_at) > Date.now())
  );

  // Logged before the early return so a probe for a valid-looking token is
  // recorded whether or not it worked.
  await log(tokenHash, ok, audit);
  if (!row || !ok) return null;

  await pg.patch("portal_links", { id: `eq.${row.id}` }, {
    last_used_at: new Date().toISOString(),
    use_count: row.use_count + 1,
  });

  return {
    clientId: row.client_id,
    quoteId: row.quote_id ?? undefined,
    jobId: row.job_id ?? undefined,
    invoiceId: row.invoice_id ?? undefined,
  };
}

export async function revokePortalLinks(clientId: string): Promise<void> {
  if (!SUPABASE_LIVE) return;
  await pg.patch("portal_links", { client_id: `eq.${clientId}`, revoked_at: "is.null" }, {
    revoked_at: new Date().toISOString(),
  });
}

async function log(
  tokenHash: string,
  ok: boolean,
  audit: { ip?: string; userAgent?: string; path: string }
): Promise<void> {
  try {
    const company = await pg.rpc<string>("company_id", {});
    await pg.insert("portal_access_log", {
      company_id: company,
      token_hash: tokenHash,
      ok,
      ip_address: audit.ip || null,
      user_agent: audit.userAgent || null,
      path: audit.path,
    });
  } catch {
    // The audit trail must never be the reason a customer cannot open their
    // own project page.
  }
}

/**
 * Where customer-facing links point. Configured explicitly in production so a
 * link minted on a preview deployment never carries that preview's hostname.
 */
export function portalOrigin(host?: string | null): string {
  const configured = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (host && (host.startsWith("localhost") || host.startsWith("127.0.0.1"))) return `http://${host}`;
  return "https://hydrodam-dashboard.vercel.app";
}

export const LOGIN_LINK_DAYS = 30;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_PER_WINDOW = 3;

/**
 * The portal's front door: a customer types the email they gave HydroDam and
 * gets a fresh link by email. No passwords, because the customer already
 * proved ownership of the inbox the moment they open the link.
 *
 * Every attempt is recorded, matched or not, and the reply to the browser is
 * the same either way, so the form cannot be used to check which emails have
 * a project. A HubSpot-only lead becomes a client row on first sign-in, which
 * is the same promotion the office performs when it first touches them.
 */
export async function requestPortalLogin(
  rawEmail: string,
  audit: { ip?: string; userAgent?: string }
): Promise<{ sent: boolean; reason?: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!SUPABASE_LIVE) return { sent: false, reason: "no_db" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sent: false, reason: "invalid" };

  const company = await pg.rpc<string>("company_id", {});
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const recent = await pg.select<{ id: number }>("portal_login_requests", {
    select: "id",
    email: `eq.${email}`,
    created_at: `gte.${since}`,
    limit: String(LOGIN_MAX_PER_WINDOW + 1),
  });
  if (recent.length >= LOGIN_MAX_PER_WINDOW) return { sent: false, reason: "rate_limited" };

  await ensureData();
  const lead = db().clients.find((c) => !c.demo && c.email?.trim().toLowerCase() === email);

  let clientId: string | undefined;
  if (lead) {
    try {
      clientId = (await realClientId(lead.id)).clientId;
    } catch (err) {
      console.warn("[portal] could not promote lead for login", err);
    }
  }

  await pg.insert("portal_login_requests", {
    company_id: company,
    email,
    client_id: clientId ?? null,
    matched: Boolean(clientId),
    ip_address: audit.ip || null,
    user_agent: audit.userAgent || null,
  });
  if (!clientId) return { sent: false, reason: "no_match" };

  const token = await mintPortalLink({ clientId, days: LOGIN_LINK_DAYS });
  if (!token) return { sent: false, reason: "mint_failed" };

  const firstName = lead!.name.trim().split(/\s+/)[0] || "there";
  const url = `${portalOrigin()}/p/${token}`;
  const result = await sendEmail({
    to: email,
    subject: "Your HydroDam project link",
    html: shell({
      heading: `Here is your project, ${firstName}`,
      body:
        para("Use the button below to open your HydroDam project. It shows where things stand, lets you book your on-site assessment, and holds your estimate and documents.") +
        para(`This link is private to you and works for ${LOGIN_LINK_DAYS} days. If you did not ask for it, you can ignore this email.`),
      cta: { label: "Open my project", href: url },
    }),
  });
  return result.ok ? { sent: true } : { sent: false, reason: result.error };
}
