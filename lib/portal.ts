import "server-only";
import { createHash, randomBytes } from "node:crypto";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";

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
