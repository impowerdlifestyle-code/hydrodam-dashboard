import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, LinkButton, PageHeader } from "@/components/ui";
import { TextsPanel } from "@/components/TextsPanel";
import { ensureData, getClient, propertyFor } from "@/lib/db";
import { phoneDisplay } from "@/lib/format";
import { consentState } from "@/lib/sms-copilot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONSENT_LABEL = {
  marketing: ["Marketing + transactional consent", "good"],
  transactional: ["Transactional consent only", "teal"],
  stop: ["Texted STOP", "bad"],
  none: ["No SMS consent on file", "bad"],
} as const;

export default async function TextThreadPage({ params }: { params: Promise<{ clientId: string }> }) {
  await ensureData();
  const { clientId } = await params;
  const client = getClient(clientId);
  if (!client) notFound();
  const prop = propertyFor(client.id);
  const [label, tone] = CONSENT_LABEL[consentState(client)];

  return (
    <>
      <Link href="/texts" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Texts
      </Link>

      <PageHeader
        title={client.name}
        subtitle={`${phoneDisplay(client.phone)}${prop ? ` · ${prop.city}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{label}</Badge>
            <LinkButton href={`/clients/${client.id}`} variant="secondary" size="sm" icon="user">Client</LinkButton>
          </div>
        }
      />

      <TextsPanel client={client} />
    </>
  );
}
