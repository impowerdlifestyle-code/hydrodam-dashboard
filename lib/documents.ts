import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";

/**
 * Files on a client's project: the website estimate, Emma's project plan, the
 * itemized estimate. Bytes live in the private `client-docs` bucket; rows here
 * are what the portal and the office list. Uploads go browser -> Storage on a
 * signed URL so a 20 MB plan never passes through a Vercel function.
 */

export const BUCKET = "client-docs";
export const MAX_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export const DOC_KINDS = {
  website_estimate: "Website estimate",
  project_plan: "Project plan",
  itemized_estimate: "Itemized estimate",
  agreement: "Agreement",
  photo: "Photo",
  other: "Document",
} as const;
export type DocKind = keyof typeof DOC_KINDS;

export type ClientDocument = {
  id: string;
  client_id: string;
  kind: DocKind;
  title: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
  visible_to_client: boolean;
  uploaded_by: string | null;
  created_at: string;
};

const COLS = "id,client_id,kind,title,storage_path,mime,size_bytes,visible_to_client,uploaded_by,created_at";

function storageHeaders(): HeadersInit {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
const storage = (path: string) => `${process.env.SUPABASE_URL}/storage/v1${path}`;

export async function listDocuments(clientId: string, opts: { clientVisibleOnly?: boolean } = {}): Promise<ClientDocument[]> {
  if (!SUPABASE_LIVE || clientId.startsWith("hs_")) return [];
  const q: Record<string, string> = { select: COLS, client_id: `eq.${clientId}`, order: "created_at.desc" };
  if (opts.clientVisibleOnly) q.visible_to_client = "is.true";
  return pg.select<ClientDocument>("client_documents", q);
}

export async function getDocument(id: string): Promise<ClientDocument | undefined> {
  if (!SUPABASE_LIVE) return undefined;
  const [row] = await pg.select<ClientDocument>("client_documents", { select: COLS, id: `eq.${id}`, limit: "1" });
  return row;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

/** A one-shot URL the browser PUTs the file to. Nothing is recorded until `recordDocument`. */
export async function signUpload(clientId: string, filename: string, mime: string, size: number): Promise<{ ok: true; path: string; uploadUrl: string } | { ok: false; error: string }> {
  if (!SUPABASE_LIVE) return { ok: false, error: "No storage configured." };
  if (!ALLOWED_MIME.has(mime)) return { ok: false, error: "PDF, PNG, JPG or WebP only." };
  if (size > MAX_BYTES) return { ok: false, error: "That file is over 25 MB." };
  const path = `${clientId}/${Date.now().toString(36)}-${safeName(filename)}`;
  const res = await fetch(storage(`/object/upload/sign/${BUCKET}/${path}`), { method: "POST", headers: storageHeaders(), body: "{}", cache: "no-store" });
  if (!res.ok) return { ok: false, error: `Storage refused the upload (${res.status}).` };
  const body = (await res.json()) as { url?: string; token?: string };
  if (!body.url) return { ok: false, error: "Storage returned no upload URL." };
  return { ok: true, path, uploadUrl: storage(body.url.startsWith("/") ? body.url : `/${body.url}`) };
}

export async function recordDocument(input: {
  clientId: string; kind: DocKind; title: string; path: string; mime: string; size: number; uploadedBy?: string;
}): Promise<ClientDocument> {
  const company = await pg.rpc<string>("company_id", {});
  const [row] = await pg.insert<ClientDocument>("client_documents", {
    company_id: company,
    client_id: input.clientId,
    kind: input.kind in DOC_KINDS ? input.kind : "other",
    title: input.title.trim().slice(0, 120) || DOC_KINDS[input.kind] || "Document",
    storage_path: input.path,
    mime: input.mime,
    size_bytes: input.size,
    uploaded_by: input.uploadedBy ?? null,
  });
  return row;
}

/** A short-lived read URL. The portal route and the office route both redirect to one. */
export async function signDownload(path: string, seconds = 300): Promise<string | null> {
  const res = await fetch(storage(`/object/sign/${BUCKET}/${path}`), {
    method: "POST", headers: storageHeaders(), body: JSON.stringify({ expiresIn: seconds }), cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { signedURL?: string };
  return body.signedURL ? storage(body.signedURL.startsWith("/") ? body.signedURL : `/${body.signedURL}`) : null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await getDocument(id);
  if (!doc) return false;
  await fetch(storage(`/object/${BUCKET}`), { method: "DELETE", headers: storageHeaders(), body: JSON.stringify({ prefixes: [doc.storage_path] }), cache: "no-store" });
  await pg.remove("client_documents", { id: `eq.${id}` });
  return true;
}

export async function setDocumentVisibility(id: string, visible: boolean): Promise<void> {
  await pg.patch("client_documents", { id: `eq.${id}` }, { visible_to_client: visible });
}
