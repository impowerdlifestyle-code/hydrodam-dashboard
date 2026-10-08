import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { db, ensureData, realClientId } from "@/lib/db";
import { PASSWORD_MIN } from "@/lib/portal-password";
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
  created_at: string;
};

const live = (row: Pick<LinkRow, "expires_at" | "revoked_at"> | undefined): boolean =>
  Boolean(row && !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now()));

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
    select: "id,client_id,quote_id,job_id,invoice_id,expires_at,revoked_at,use_count,created_at",
    token_hash: `eq.${tokenHash}`,
    limit: "1",
  });

  const ok = live(row);

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
  // A password mints a fresh link on every sign-in, so revoking the links
  // alone would leave the way back in standing.
  await pg.remove("portal_accounts", { client_id: `eq.${clientId}` });
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
 * The emailed link: how a customer gets in the first time, and how they get
 * back in after forgetting their password. Opening it proves they own the
 * inbox, which is the only thing that entitles them to choose a password.
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
    kind: "eq.link",
    created_at: `gte.${since}`,
    limit: String(LOGIN_MAX_PER_WINDOW + 1),
  });
  if (recent.length >= LOGIN_MAX_PER_WINDOW) return { sent: false, reason: "rate_limited" };

  await ensureData({ fresh: true });
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
  const hasAccount = Boolean(await accountFor(clientId));
  const url = `${portalOrigin()}/p/${token}${hasAccount ? "/password" : ""}`;
  const result = await sendEmail({
    to: email,
    clientId,
    subject: hasAccount ? "Your HydroDam sign-in link" : "Set up your HydroDam account",
    html: shell({
      heading: hasAccount ? `Here is your sign-in link, ${firstName}` : `Set up your account, ${firstName}`,
      body: hasAccount
        ? para("Use the button below to choose a new password for your HydroDam account, or skip that step and go straight to your project.") +
          para(`Choosing a new password works for ${RESET_WINDOW_MINUTES} minutes. After that the link still opens your project for ${LOGIN_LINK_DAYS} days. If you did not ask for it, you can ignore this email.`)
        : para("Use the button below to open your HydroDam project. The first time, we will ask you to choose a password so you can sign in whenever you like.") +
          para("Your project shows where things stand, lets you book your on-site assessment, and holds your estimate and documents.") +
          para(`This link is private to you and works for ${LOGIN_LINK_DAYS} days. If you did not ask for it, you can ignore this email.`),
      cta: { label: hasAccount ? "Choose a new password" : "Set up my account", href: url },
    }),
  });
  return result.ok ? { sent: true } : { sent: false, reason: result.error };
}

// ------------------------------------------------------------------ accounts

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_BYTES = 64;

export const RESET_WINDOW_MINUTES = 60;
const PASSWORD_MAX_FAILS = 5;

type AccountRow = { client_id: string; email: string; password_hash: string };

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_BYTES);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

async function accountFor(clientId: string): Promise<AccountRow | undefined> {
  const [row] = await pg.select<AccountRow>("portal_accounts", {
    select: "client_id,email,password_hash",
    client_id: `eq.${clientId}`,
    limit: "1",
  });
  return row;
}

export type PortalGate = {
  clientId: string;
  hasAccount: boolean;
  /** Minted recently enough that it may replace an existing password. */
  fresh: boolean;
};

/**
 * What the layout needs to decide between the project and the account setup
 * step. Not logged and not counted: the page underneath resolves the same
 * token and records the visit once.
 */
export async function portalGate(token: string): Promise<PortalGate | null> {
  if (!SUPABASE_LIVE) return null;
  const [row] = await pg.select<LinkRow>("portal_links", {
    select: "id,client_id,expires_at,revoked_at,created_at",
    token_hash: `eq.${hash(token)}`,
    limit: "1",
  });
  if (!row || !live(row)) return null;
  return {
    clientId: row.client_id,
    hasAccount: Boolean(await accountFor(row.client_id)),
    fresh: Date.now() - Date.parse(row.created_at) < RESET_WINDOW_MINUTES * 60_000,
  };
}

/**
 * Creates the account, or replaces its password. A first password can be set
 * from any live link, because that link is the invitation. Replacing one
 * needs a link minted in the last hour, so a link forwarded weeks ago cannot
 * be turned into a permanent way in.
 */
export async function setPortalPassword(
  token: string,
  password: string,
  rawEmail?: string
): Promise<{ ok: boolean; reason?: "expired" | "stale" | "weak" | "email" }> {
  const gate = await portalGate(token);
  if (!gate) return { ok: false, reason: "expired" };
  if (gate.hasAccount && !gate.fresh) return { ok: false, reason: "stale" };
  if (password.length < PASSWORD_MIN || password.length > 200) return { ok: false, reason: "weak" };

  const now = new Date().toISOString();
  if (gate.hasAccount) {
    await pg.patch("portal_accounts", { client_id: `eq.${gate.clientId}` }, {
      password_hash: await hashPassword(password),
      updated_at: now,
    });
    return { ok: true };
  }

  await ensureData();
  let client = db().clients.find((c) => c.id === gate.clientId);
  if (!client) {
    await ensureData({ fresh: true });
    client = db().clients.find((c) => c.id === gate.clientId);
  }
  const email = (client?.email || rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "email" };

  await pg.insert("portal_accounts", {
    client_id: gate.clientId,
    company_id: await pg.rpc<string>("company_id", {}),
    email,
    password_hash: await hashPassword(password),
    last_login_at: now,
  }, { onConflict: "client_id" });
  return { ok: true };
}

/**
 * Email and password at /p/login. A correct password mints an ordinary portal
 * link, so everything past the front door keeps working on the one credential
 * it already checks.
 */
export async function passwordLogin(
  rawEmail: string,
  password: string,
  audit: { ip?: string; userAgent?: string }
): Promise<{ token?: string; reason?: "no_db" | "rate_limited" | "no_match" }> {
  const email = rawEmail.trim().toLowerCase();
  if (!SUPABASE_LIVE) return { reason: "no_db" };

  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const fails = await pg.select<{ id: number }>("portal_login_requests", {
    select: "id",
    email: `eq.${email}`,
    kind: "eq.password",
    matched: "eq.false",
    created_at: `gte.${since}`,
    limit: String(PASSWORD_MAX_FAILS + 1),
  });
  if (fails.length >= PASSWORD_MAX_FAILS) return { reason: "rate_limited" };

  const accounts = await pg.select<AccountRow>("portal_accounts", {
    select: "client_id,email,password_hash",
    email: `eq.${email}`,
    limit: "5",
  });
  let match: AccountRow | undefined;
  for (const account of accounts) {
    if (await verifyPassword(password, account.password_hash)) match = account;
  }
  // An unknown email costs the same scrypt as a known one.
  if (!accounts.length) await hashPassword(password);

  await pg.insert("portal_login_requests", {
    company_id: await pg.rpc<string>("company_id", {}),
    email,
    kind: "password",
    client_id: match?.client_id ?? null,
    matched: Boolean(match),
    ip_address: audit.ip || null,
    user_agent: audit.userAgent || null,
  });
  if (!match) return { reason: "no_match" };

  await pg.patch("portal_accounts", { client_id: `eq.${match.client_id}` }, {
    last_login_at: new Date().toISOString(),
  });
  return { token: await mintPortalLink({ clientId: match.client_id, days: LOGIN_LINK_DAYS }) };
}
