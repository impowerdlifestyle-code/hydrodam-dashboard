import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINOR_VERSION = "75";
const PAGE_SIZE = 100;
const FIRST_SYNC_FROM = "2024-01-01T00:00:00+00:00";

export const QB_CONFIGURED: boolean = Boolean(process.env.QB_CLIENT_ID && process.env.QB_CLIENT_SECRET);

const ENVIRONMENT: "sandbox" | "production" =
  process.env.QB_ENVIRONMENT === "sandbox" ? "sandbox" : "production";

const API_BASE =
  ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

function redirectUri(): string {
  return (
    process.env.QB_REDIRECT_URI ??
    `${process.env.PORTAL_BASE_URL ?? "https://hydrodam-dashboard.vercel.app"}/api/quickbooks/callback`
  );
}

function basicAuth(): string {
  return Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
}

/* ------------------------------------------------------------------ types */

export type QbLine = { name: string; description?: string; quantity: number; rateCents: number; amountCents: number };

export type QbEstimate = {
  id: string; qbId: string; docNumber?: string; txnDate?: string; expirationDate?: string;
  txnStatus?: string; customerName?: string; customerEmail?: string; clientId?: string;
  subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
  lines: QbLine[]; memo?: string; acceptedBy?: string; acceptedAt?: string; syncedAt: string;
};

export type QbConnectionInfo = {
  realmId: string; environment: "sandbox" | "production"; connectedAt: string;
  connectedBy?: string; lastSyncAt?: string; lastSyncError?: string;
};

type ConnectionRow = {
  company_id: string;
  realm_id: string;
  environment: "sandbox" | "production";
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_error: string | null;
};

type StoredLine = { name: string; description?: string; quantity: number; rate_cents: number; amount_cents: number };

type EstimateRow = {
  id: string;
  company_id: string;
  realm_id: string;
  qb_id: string;
  doc_number: string | null;
  txn_date: string | null;
  expiration_date: string | null;
  txn_status: string | null;
  customer_ref: string | null;
  customer_name: string | null;
  customer_email: string | null;
  client_id: string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  lines: StoredLine[];
  memo: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  qb_updated_at: string | null;
  synced_at: string;
  raw: Record<string, unknown> | null;
};

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

type QboLine = {
  DetailType?: string;
  Amount?: number;
  Description?: string;
  SalesItemLineDetail?: { ItemRef?: { name?: string; value?: string }; Qty?: number; UnitPrice?: number };
  DiscountLineDetail?: Record<string, unknown>;
  SubTotalLineDetail?: Record<string, unknown>;
};

type QboEstimate = {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string;
  ExpirationDate?: string;
  TxnStatus?: string;
  CustomerRef?: { value?: string; name?: string };
  BillEmail?: { Address?: string };
  CustomerMemo?: { value?: string };
  TotalAmt?: number;
  AcceptedBy?: string;
  AcceptedDate?: string;
  MetaData?: { LastUpdatedTime?: string; CreateTime?: string };
  TxnTaxDetail?: { TotalTax?: number };
  Line?: QboLine[];
};

/* ------------------------------------------------------------- connection */

async function loadConnection(): Promise<ConnectionRow | null> {
  if (!SUPABASE_LIVE) return null;
  const [row] = await pg.select<ConnectionRow>("quickbooks_connections", { select: "*", limit: "1" });
  return row ?? null;
}

function isFresh(conn: ConnectionRow): boolean {
  return Boolean(
    conn.access_token && conn.access_expires_at && Date.parse(conn.access_expires_at) > Date.now() + 60_000
  );
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`QuickBooks token request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

export function qbAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID ?? "",
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function qbExchangeCode(code: string, realmId: string, connectedBy?: string): Promise<void> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const company = await pg.rpc<string>("company_id", {});
  const now = new Date().toISOString();
  await pg.insert(
    "quickbooks_connections",
    {
      company_id: company,
      realm_id: realmId,
      environment: ENVIRONMENT,
      refresh_token: t.refresh_token,
      access_token: t.access_token,
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      connected_by: connectedBy ?? null,
      connected_at: now,
      updated_at: now,
      last_sync_at: null,
      last_sync_error: null,
    },
    { onConflict: "company_id" }
  );
}

// Intuit rotates the refresh token on every use, so two concurrent refreshes
// race to persist different tokens and the loser is left holding a dead one.
let refreshInFlight: Promise<ConnectionRow> | null = null;

async function refreshConnection(conn: ConnectionRow): Promise<ConnectionRow> {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  const values = {
    refresh_token: t.refresh_token,
    access_token: t.access_token,
    access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await pg.patch("quickbooks_connections", { company_id: `eq.${conn.company_id}` }, values);
  return { ...conn, ...values };
}

async function accessToken(): Promise<{ token: string; realmId: string }> {
  const conn = await loadConnection();
  if (!conn) throw new Error("QuickBooks is not connected.");
  if (isFresh(conn)) return { token: conn.access_token!, realmId: conn.realm_id };

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const latest = await loadConnection();
      if (latest && isFresh(latest)) return latest;
      return refreshConnection(latest ?? conn);
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  const fresh = await refreshInFlight;
  return { token: fresh.access_token!, realmId: fresh.realm_id };
}

export async function qbDisconnect(): Promise<void> {
  const conn = await loadConnection();
  if (!conn) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: conn.refresh_token }),
      cache: "no-store",
    });
  } catch {
    /* best effort */
  }
  await pg.remove("quickbooks_connections", { company_id: `eq.${conn.company_id}` });
}

export async function qbConnection(): Promise<QbConnectionInfo | null> {
  const conn = await loadConnection();
  if (!conn) return null;
  return {
    realmId: conn.realm_id,
    environment: conn.environment,
    connectedAt: conn.connected_at,
    connectedBy: conn.connected_by ?? undefined,
    lastSyncAt: conn.last_sync_at ?? undefined,
    lastSyncError: conn.last_sync_error ?? undefined,
  };
}

/* -------------------------------------------------------------------- api */

type QbRequest = { method?: "GET" | "POST"; body?: string; query?: Record<string, string>; accept?: string };

async function qbFetch(path: string, req: QbRequest = {}): Promise<Response> {
  const { token, realmId } = await accessToken();
  const url = new URL(`${API_BASE}/v3/company/${realmId}${path}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("minorversion", MINOR_VERSION);
  return fetch(url.toString(), {
    method: req.method ?? "GET",
    body: req.body,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: req.accept ?? "application/json",
      ...(req.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
}

async function qbJson<T>(path: string, req: QbRequest = {}): Promise<T> {
  const res = await qbFetch(path, req);
  if (!res.ok) throw new Error(`QuickBooks ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const cents = (n: number | undefined | null): number => Math.round((n ?? 0) * 100);

function mapEstimate(e: QboEstimate, email: string | undefined, company: string, realmId: string) {
  const lines: StoredLine[] = [];
  let discount = 0;
  let subtotal: number | undefined;
  for (const l of e.Line ?? []) {
    if (l.DetailType === "SalesItemLineDetail") {
      const d = l.SalesItemLineDetail ?? {};
      const quantity = d.Qty ?? 1;
      lines.push({
        name: d.ItemRef?.name ?? "Item",
        description: l.Description,
        quantity,
        rate_cents: cents(d.UnitPrice),
        amount_cents: cents(l.Amount),
      });
    } else if (l.DetailType === "DiscountLineDetail") {
      discount += cents(l.Amount);
    } else if (l.DetailType === "SubTotalLineDetail") {
      subtotal = cents(l.Amount);
    }
  }
  return {
    company_id: company,
    realm_id: realmId,
    qb_id: e.Id,
    doc_number: e.DocNumber ?? null,
    txn_date: e.TxnDate ?? null,
    expiration_date: e.ExpirationDate ?? null,
    txn_status: e.TxnStatus ?? null,
    customer_ref: e.CustomerRef?.value ?? null,
    customer_name: e.CustomerRef?.name ?? null,
    customer_email: email?.trim() || null,
    subtotal_cents: subtotal ?? lines.reduce((s, l) => s + l.amount_cents, 0),
    discount_cents: discount,
    tax_cents: cents(e.TxnTaxDetail?.TotalTax),
    total_cents: cents(e.TotalAmt),
    lines,
    memo: e.CustomerMemo?.value ?? null,
    accepted_by: e.AcceptedBy ?? null,
    accepted_at: e.AcceptedDate ?? null,
    qb_updated_at: e.MetaData?.LastUpdatedTime ?? null,
    synced_at: new Date().toISOString(),
    raw: e,
  };
}

function qbTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function matchClients(company: string): Promise<number> {
  const unmatched = await pg.select<{ id: string; customer_email: string }>("quickbooks_estimates", {
    select: "id,customer_email",
    company_id: `eq.${company}`,
    client_id: "is.null",
    customer_email: "not.is.null",
    limit: "1000",
  });
  const byEmail = new Map<string, string[]>();
  for (const r of unmatched) {
    const key = r.customer_email.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), r.id]);
  }
  let matched = 0;
  for (const [email, ids] of byEmail) {
    const [client] = await pg.select<{ id: string }>("clients", {
      select: "id",
      company_id: `eq.${company}`,
      email: `ilike.${email}`,
      archived_at: "is.null",
      limit: "1",
    });
    if (!client) continue;
    await pg.patch("quickbooks_estimates", { id: `in.(${ids.join(",")})` }, { client_id: client.id });
    matched += ids.length;
  }
  return matched;
}

export async function syncQuickBooksEstimates(
  opts?: { full?: boolean }
): Promise<{ fetched: number; upserted: number; matched: number; error?: string }> {
  const out = { fetched: 0, upserted: 0, matched: 0 };
  let conn: ConnectionRow | null = null;
  try {
    conn = await loadConnection();
    if (!conn) return { ...out, error: "QuickBooks is not connected." };

    const since =
      opts?.full || !conn.last_sync_at
        ? FIRST_SYNC_FROM
        : qbTimestamp(Date.parse(conn.last_sync_at) - 86_400_000);

    const customerEmails = new Map<string, string | undefined>();
    const emailFor = async (e: QboEstimate): Promise<string | undefined> => {
      if (e.BillEmail?.Address) return e.BillEmail.Address;
      const ref = e.CustomerRef?.value;
      if (!ref) return undefined;
      if (!customerEmails.has(ref)) {
        try {
          const c = await qbJson<{ Customer?: { PrimaryEmailAddr?: { Address?: string } } }>(`/customer/${ref}`);
          customerEmails.set(ref, c.Customer?.PrimaryEmailAddr?.Address);
        } catch {
          customerEmails.set(ref, undefined);
        }
      }
      return customerEmails.get(ref);
    };

    let start = 1;
    for (;;) {
      const query =
        `select * from Estimate where MetaData.LastUpdatedTime > '${since}' ` +
        `orderby MetaData.LastUpdatedTime startposition ${start} maxresults ${PAGE_SIZE}`;
      const page = await qbJson<{ QueryResponse?: { Estimate?: QboEstimate[] } }>("/query", { query: { query } });
      const estimates = page.QueryResponse?.Estimate ?? [];
      out.fetched += estimates.length;

      if (estimates.length) {
        const rows = [];
        for (const e of estimates) rows.push(mapEstimate(e, await emailFor(e), conn.company_id, conn.realm_id));
        const saved = await pg.insert<{ id: string }>("quickbooks_estimates", rows, { onConflict: "realm_id,qb_id" });
        out.upserted += saved.length;
      }
      if (estimates.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
    }

    out.matched = await matchClients(conn.company_id);
    await pg.patch(
      "quickbooks_connections",
      { company_id: `eq.${conn.company_id}` },
      { last_sync_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString() }
    );
    return out;
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : "Sync failed.";
    if (conn) {
      try {
        await pg.patch(
          "quickbooks_connections",
          { company_id: `eq.${conn.company_id}` },
          { last_sync_error: error, updated_at: new Date().toISOString() }
        );
      } catch {
        /* the error text itself is the report */
      }
    }
    return { ...out, error };
  }
}

/* ------------------------------------------------------------------ reads */

function toEstimate(r: EstimateRow): QbEstimate {
  return {
    id: r.id,
    qbId: r.qb_id,
    docNumber: r.doc_number ?? undefined,
    txnDate: r.txn_date ?? undefined,
    expirationDate: r.expiration_date ?? undefined,
    txnStatus: r.txn_status ?? undefined,
    customerName: r.customer_name ?? undefined,
    customerEmail: r.customer_email ?? undefined,
    clientId: r.client_id ?? undefined,
    subtotalCents: Number(r.subtotal_cents),
    discountCents: Number(r.discount_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    lines: (r.lines ?? []).map((l) => ({
      name: l.name,
      description: l.description,
      quantity: Number(l.quantity),
      rateCents: Number(l.rate_cents),
      amountCents: Number(l.amount_cents),
    })),
    memo: r.memo ?? undefined,
    acceptedBy: r.accepted_by ?? undefined,
    acceptedAt: r.accepted_at ?? undefined,
    syncedAt: r.synced_at,
  };
}

export async function qbEstimatesForClient(clientId: string, email?: string): Promise<QbEstimate[]> {
  if (!SUPABASE_LIVE) return [];
  const addr = email?.trim();
  const rows = await pg.select<EstimateRow>("quickbooks_estimates", {
    select: "*",
    ...(addr
      ? { or: `(client_id.eq.${clientId},customer_email.ilike.${addr})` }
      : { client_id: `eq.${clientId}` }),
    order: "txn_date.desc.nullslast,synced_at.desc",
    limit: "200",
  });
  const stray = rows.filter((r) => !r.client_id).map((r) => r.id);
  if (stray.length) {
    await pg.patch("quickbooks_estimates", { id: `in.(${stray.join(",")})` }, { client_id: clientId });
    for (const r of rows) if (!r.client_id) r.client_id = clientId;
  }
  return rows.map(toEstimate);
}

export async function qbEstimateById(id: string): Promise<QbEstimate | undefined> {
  if (!SUPABASE_LIVE) return undefined;
  const [row] = await pg.select<EstimateRow>("quickbooks_estimates", { select: "*", id: `eq.${id}`, limit: "1" });
  return row ? toEstimate(row) : undefined;
}

export async function qbEstimatePdf(estimate: QbEstimate): Promise<ArrayBuffer | null> {
  try {
    const res = await qbFetch(`/estimate/${estimate.qbId}/pdf`, { accept: "application/pdf" });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function qbMarkAccepted(estimate: QbEstimate, by: { name: string; at: Date }): Promise<boolean> {
  try {
    const current = await qbJson<{ Estimate?: QboEstimate }>(`/estimate/${estimate.qbId}`);
    const syncToken = current.Estimate?.SyncToken;
    if (!syncToken) return false;

    const acceptedDate = by.at.toISOString().slice(0, 10);
    const updated = await qbJson<{ Estimate?: QboEstimate }>("/estimate", {
      method: "POST",
      body: JSON.stringify({
        Id: estimate.qbId,
        SyncToken: syncToken,
        sparse: true,
        TxnStatus: "Accepted",
        AcceptedBy: by.name,
        AcceptedDate: acceptedDate,
      }),
    });

    await pg.patch(
      "quickbooks_estimates",
      { id: `eq.${estimate.id}` },
      {
        txn_status: updated.Estimate?.TxnStatus ?? "Accepted",
        accepted_by: by.name,
        accepted_at: by.at.toISOString(),
        qb_updated_at: updated.Estimate?.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        synced_at: new Date().toISOString(),
        ...(updated.Estimate ? { raw: updated.Estimate } : {}),
      }
    );
    return true;
  } catch {
    return false;
  }
}
