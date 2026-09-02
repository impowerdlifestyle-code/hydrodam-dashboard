import { NextResponse } from "next/server";
import { hasSession } from "@/lib/session";
import { getDocument, signDownload } from "@/lib/documents";

export const runtime = "nodejs";

/** Office view of a file: session-gated, then a five-minute signed URL. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = await ctx.params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = await signDownload(doc.storage_path);
  if (!url) return NextResponse.json({ error: "Could not sign." }, { status: 502 });
  return NextResponse.redirect(url, 302);
}
