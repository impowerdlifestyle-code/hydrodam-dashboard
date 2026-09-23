import { ensureData, getClient } from "@/lib/db";
import { conversationIdForPhone, messagesIn } from "@/lib/comms";
import { requireSession } from "@/lib/session";
import { DraftingUnavailable, draftText, kindOf, voiceWarnings } from "@/lib/sms-copilot";
import { currentStaff } from "@/lib/whoami";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    await requireSession();
  } catch {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  await ensureData();

  let input: { clientId?: string; kind?: string; instruction?: string };
  try {
    input = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const client = input.clientId ? getClient(input.clientId) : undefined;
  if (!client) return Response.json({ error: "No such client." }, { status: 404 });
  const kind = input.kind ? kindOf(input.kind) : undefined;
  if (!kind) return Response.json({ error: "Pick a kind of message." }, { status: 400 });
  const instruction = input.instruction?.trim().slice(0, 600) || undefined;
  if (kind.id === "custom" && !instruction) {
    return Response.json({ error: "A custom text needs an instruction." }, { status: 400 });
  }

  const conversationId = client.phone ? await conversationIdForPhone(client.phone) : undefined;
  const thread = conversationId ? await messagesIn(conversationId) : [];
  if (kind.id === "reply_to_latest" && !thread.some((m) => m.direction === "inbound")) {
    return Response.json({ error: "They have not texted us, so there is nothing to reply to." }, { status: 400 });
  }

  try {
    const draft = await draftText({
      client,
      kind: kind.id,
      thread,
      instruction,
      createdBy: (await currentStaff())?.name,
    });
    return Response.json({ draftId: draft.id, text: draft.draftText, warnings: voiceWarnings(draft.draftText) });
  } catch (err) {
    if (err instanceof DraftingUnavailable) return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: err instanceof Error ? err.message : "Drafting failed." }, { status: 500 });
  }
}
