import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, PageHeader, Panel, SectionLabel } from "@/components/ui";
import { clientName, getClient, getConversation, messagesFor, propertyFor } from "@/lib/db";
import { dateTime, phoneDisplay, relative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) notFound();

  const client = getClient(conv.clientId);
  const msgs = messagesFor(conv.id);
  const prop = propertyFor(conv.clientId);

  return (
    <>
      <Link href="/inbox" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Inbox
      </Link>

      <PageHeader
        title={clientName(conv.clientId)}
        subtitle={`${conv.channel.toUpperCase()} · ${conv.channel === "sms" ? phoneDisplay(conv.externalAddress) : conv.externalAddress}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionLabel>Thread</SectionLabel>
          <ul className="flex flex-col gap-3">
            {msgs.map((m) => {
              const out = m.direction === "outbound";
              return (
                <li key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${out ? "bg-teal/15 ring-1 ring-line-bright" : "bg-white/5"}`}>
                    <p className="text-sm leading-relaxed text-ink">{m.body}</p>
                    <p className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {dateTime(m.createdAt)}
                      {m.templateKey && <span className="text-teal">· {m.templateKey.replace(/_/g, " ")}</span>}
                      {!m.read && !out && <span className="text-ember">· unread</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 rounded-xl border border-line bg-abyss-2 p-3">
            <p className="text-sm text-ink-faint">
              Replying needs Telnyx connected and a number registered to Hydro Dam LLC under A2P 10DLC.
            </p>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Client
              </SectionLabel>
              <p className="font-display text-base font-semibold text-ink">{client.name}</p>
              <p className="mt-1 text-sm text-ink-dim">{prop?.address}</p>
              <p className="text-sm text-ink-dim">{prop?.city}, FL {prop?.postalCode}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={client.smsConsent ? "good" : "bad"}>
                  {client.smsConsent ? "SMS consented" : "No SMS consent"}
                </Badge>
                <Badge tone="teal">{client.leadSource}</Badge>
              </div>
              {!client.smsConsent && (
                <p className="mt-3 text-xs text-ink-faint">
                  Marketing texts are blocked for this client. Transactional messages about a booked job still send.
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
