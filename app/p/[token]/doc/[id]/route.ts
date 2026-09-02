import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolvePortalToken } from "@/lib/portal";
import { getDocument, signDownload } from "@/lib/documents";

export const runtime = "nodejs";

/**
 * The customer opening one of their own files. The portal token is the
 * credential, the document must belong to that client and be marked visible,
 * and what they get is a five-minute signed URL, never the bucket path.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await ctx.params;
  const head = await headers();
  const link = await resolvePortalToken(token, {
    ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: head.get("user-agent") ?? undefined,
    path: "/p/doc",
  });
  if (!link) return new NextResponse("This link has expired.", { status: 403 });
  const doc = await getDocument(id);
  if (!doc || doc.client_id !== link.clientId || !doc.visible_to_client) return new NextResponse("Not found.", { status: 404 });
  const url = await signDownload(doc.storage_path);
  if (!url) return new NextResponse("Could not open the file.", { status: 502 });
  return NextResponse.redirect(url, 302);
}
