import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalView } from "@/components/PortalView";
import { PageHeader } from "@/components/ui";
import { ensureData, getClient } from "@/lib/db";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;

/**
 * The customer's portal, rendered for the team behind the ops session.
 *
 * Deliberately not a link to /p/:token — a real token is a live credential and
 * this is only ever a look. Nothing here writes, and the approve CTA is inert,
 * because a quote approval has to come from the customer's own click for the
 * signature record to mean anything.
 */
export default async function ClientPortalPreview({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const client = getClient(id);
  if (!client) notFound();

  return (
    <>
      <Link href={`/clients/${id}`} className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← {client.name}
      </Link>

      <PageHeader
        title="Their portal"
        subtitle={`Exactly what ${client.name.split(" ")[0]} sees at their own link.`}
      />

      <p className="mb-5 rounded-xl border border-line bg-teal/5 px-4 py-3 text-xs leading-relaxed text-ink-dim">
        Read-only preview. Approving a quote has to be the customer&apos;s own click, so the button
        below does nothing here. To send them the real thing, mint a link from their client page.
      </p>

      <div className="overflow-hidden rounded-2xl border border-line">
        <PortalView clientId={client.id} />
      </div>
    </>
  );
}
