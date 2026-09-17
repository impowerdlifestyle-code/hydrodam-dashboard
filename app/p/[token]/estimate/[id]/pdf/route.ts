import { ensureData, getClient } from "@/lib/db";
import { resolvePortalToken } from "@/lib/portal";
import { qbEstimateById, qbEstimatePdf } from "@/lib/quickbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the QuickBooks PDF for an estimate that belongs to the token's client. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const link = await resolvePortalToken(token, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
    path: "/p/estimate/pdf",
  });
  if (!link) return new Response("Not found", { status: 404 });

  await ensureData();
  const client = getClient(link.clientId);
  const estimate = await qbEstimateById(id);
  const ownsIt =
    estimate &&
    (estimate.clientId === link.clientId ||
      (client?.email && estimate.customerEmail?.toLowerCase() === client.email.toLowerCase()));
  if (!estimate || !ownsIt) return new Response("Not found", { status: 404 });

  const pdf = await qbEstimatePdf(estimate);
  if (!pdf) return new Response("The PDF is not available right now.", { status: 503 });

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="HydroDam-estimate-${estimate.docNumber ?? estimate.qbId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
