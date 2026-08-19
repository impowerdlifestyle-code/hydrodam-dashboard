import "server-only";

/**
 * PostgREST over fetch. No SDK — every call this app makes is a select, an
 * insert or a patch, and the service-role key means no session handling.
 *
 * Everything here runs server-side with the service role, which bypasses RLS.
 * Never import this from a client component.
 */

export const SUPABASE_LIVE = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

function endpoint(table: string, query?: Record<string, string>): string {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

function headers(extra?: Record<string, string>): HeadersInit {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function send<T>(url: string, init: RequestInit): Promise<T[]> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
  }
  if (res.status === 204) return [];
  return (await res.json()) as T[];
}

export function select<T>(table: string, query: Record<string, string>): Promise<T[]> {
  return send<T>(endpoint(table, query), { method: "GET", headers: headers() });
}

/** `onConflict` turns this into an upsert on that unique index. */
export function insert<T>(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  opts?: { onConflict?: string }
): Promise<T[]> {
  const prefer = opts?.onConflict
    ? "return=representation,resolution=merge-duplicates"
    : "return=representation";
  return send<T>(endpoint(table, opts?.onConflict ? { on_conflict: opts.onConflict } : undefined), {
    method: "POST",
    headers: headers({ Prefer: prefer }),
    body: JSON.stringify(rows),
  });
}

export function patch<T>(
  table: string,
  query: Record<string, string>,
  values: Record<string, unknown>
): Promise<T[]> {
  return send<T>(endpoint(table, query), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(values),
  });
}

export function remove<T>(table: string, query: Record<string, string>): Promise<T[]> {
  return send<T>(endpoint(table, query), {
    method: "DELETE",
    headers: headers({ Prefer: "return=representation" }),
  });
}

/**
 * Calls one of the `api_*` functions from 0002_api.sql.
 *
 * These exist because PostgREST issues one statement per request, and several
 * of this app's writes have to be one transaction or not happen at all — a
 * quote and its line items, an approval and its signature, a visit and the crew
 * assignment whose overlap check can reject it. A scalar-returning function
 * answers with a bare JSON value rather than the array `send` expects, so this
 * does its own decoding.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase rpc ${fn} ${res.status}: ${detail.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
