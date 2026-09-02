import { NextResponse } from "next/server";
import { hasSession } from "@/lib/session";
import { ensureData, realClientId } from "@/lib/db";
import { currentStaff } from "@/lib/whoami";
import { deleteDocument, recordDocument, setDocumentVisibility, signUpload, type DocKind } from "@/lib/documents";

export const runtime = "nodejs";

type Body =
  | { action: "sign"; clientId: string; filename: string; mime: string; size: number }
  | { action: "record"; clientId: string; kind: DocKind; title: string; path: string; mime: string; size: number }
  | { action: "visibility"; id: string; visible: boolean };

/** Office side: sign an upload, record it once the bytes landed, toggle visibility. */
export async function POST(req: Request) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json()) as Body;
  await ensureData();

  if (body.action === "sign") {
    const { clientId } = await realClientId(body.clientId);
    const res = await signUpload(clientId, body.filename, body.mime, Number(body.size));
    return res.ok ? NextResponse.json({ ...res, clientId }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (body.action === "record") {
    if (!body.path.startsWith(`${body.clientId}/`)) return NextResponse.json({ error: "Path does not belong to that client." }, { status: 400 });
    const who = (await currentStaff())?.name;
    const doc = await recordDocument({ ...body, size: Number(body.size), uploadedBy: who });
    return NextResponse.json({ ok: true, doc });
  }
  if (body.action === "visibility") {
    await setDocumentVisibility(body.id, Boolean(body.visible));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE(req: Request) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { id } = (await req.json()) as { id: string };
  const ok = await deleteDocument(id);
  return NextResponse.json({ ok });
}
