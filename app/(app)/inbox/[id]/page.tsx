import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader, Panel, SectionLabel } from "@/components/ui";
import { ReplyComposer } from "@/components/ReplyComposer";
import { SmsThread } from "@/components/SmsThread";
import { messageTemplates } from "@/lib/builder";
import { clientOn, getConversation, markRead, messagesIn } from "@/lib/comms";
import { db, getStaff, propertyFor, quotesFor, smsGate, ensureData } from "@/lib/db";
import { longDate, phoneDisplay, relative, timeRange } from "@/lib/format";
import { portalOrigin } from "@/lib/portal";
import { VISIT_KIND_LABEL, fill, type TemplateContext } from "@/lib/templates";
import { TELNYX_LIVE } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

/** Today's visit still counts until the day is over, so "on my way" has an address. */
function upcomingVisit(clientId?: string) {
  const since = Date.now() - 12 * 3_600_000;
  return db().visits
    .filter((v) => v.clientId === clientId && Date.parse(v.scheduledStart) > since)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
}

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const conv = await getConversation(id);
  if (!conv) notFound();

  const client = await clientOn(conv);
  const msgs = await messagesIn(conv.id);
  const prop = propertyFor(conv.clientId);

  const gate = smsGate(client, "reply");
  const blocked = !TELNYX_LIVE
    ? "Telnyx isn't connected on this deployment. Set TELNYX_API_KEY and TELNYX_FROM to reply from (727) 351-8152."
    : conv.channel !== "sms"
      ? "Email replies aren't wired up yet. This thread is read-only."
      : gate.ok
        ? undefined
        : gate.reason;

  await markRead(conv.id);

  // The quick replies are filled in here with this client's real details. One
  // that needs a detail we do not have (no visit booked, no quote yet) is left
  // out, so a customer is never sent a raw {{field}}.
  const visit = upcomingVisit(conv.clientId);
  const quote = quotesFor(conv.clientId ?? "").sort((a, b) => b.number - a.number)[0];
  const ctx: TemplateContext = {
    firstName: (client?.name ?? "").split(" ")[0] || "there",
    companyPhone: "(727) 613-1415",
    visitDate: visit ? longDate(visit.scheduledStart) : undefined,
    visitWindow: visit ? timeRange(visit.scheduledStart, visit.scheduledEnd).replace(/\s*[\u2013\u2014]\s*/, " to ") : undefined,
    visitKind: visit ? VISIT_KIND_LABEL[visit.kind] : undefined,
    crewName: visit ? getStaff(visit.assignedTo[0] ?? "")?.name.trim().split(/\s+/)[0] : undefined,
    address: prop ? `${prop.address}, ${prop.city}` : undefined,
    quoteNumber: quote?.number,
    portalUrl: client?.email ? `${portalOrigin()}/p/login?email=${encodeURIComponent(client.email)}` : undefined,
  };
  const quickReplies = (await messageTemplates())
    .filter((t) => t.channel === "sms")
    .filter((t) => [...t.body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].every((m) => fill(`x {{${m[1]}}}`, ctx) !== "x"))
    .map(({ key, name, body }) => ({ key, name, body: fill(body, ctx) }));

  return (
    <>
      <Link href="/inbox" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Inbox
      </Link>

      <PageHeader
        title={client?.name ?? conv.externalAddress}
        subtitle={`${conv.channel.toUpperCase()} · ${conv.channel === "sms" ? phoneDisplay(conv.externalAddress) : conv.externalAddress}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionLabel>Thread</SectionLabel>
          <SmsThread messages={msgs} />

          <ReplyComposer
            conversationId={conv.id}
            blocked={blocked}
            templates={quickReplies}
          />
        </Panel>

        <div className="flex flex-col gap-6">
          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Client
              </SectionLabel>
              <p className="font-display text-base font-semibold text-ink">{client.name}</p>
              {prop && (
                <>
                  <p className="mt-1 text-sm text-ink-dim">{prop.address}</p>
                  <p className="text-sm text-ink-dim">{prop.city}, FL {prop.postalCode}</p>
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={client.smsConsent ? "good" : "bad"}>
                  {client.smsConsent ? "SMS consented" : "No SMS consent"}
                </Badge>
                <Badge tone={client.smsMarketingConsent ? "good" : "neutral"}>
                  {client.smsMarketingConsent ? "Marketing texts OK" : "No marketing texts"}
                </Badge>
                <Badge tone="teal">{client.leadSource}</Badge>
              </div>
              {!client.smsMarketingConsent && (
                <p className="mt-3 text-xs text-ink-faint">
                  Marketing texts are blocked for this client.
                </p>
              )}
            </Panel>
          )}

          <Panel>
            <SectionLabel>Thread</SectionLabel>
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Messages</dt>
                <dd className="text-sm text-ink">{msgs.length}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Last activity</dt>
                <dd className="text-sm text-ink">{relative(conv.lastMessageAt)}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
