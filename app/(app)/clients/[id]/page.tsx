import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge, KeyValue, LinkButton, Money, PageHeader, Panel, SectionLabel, StatusPill, Table, Td, Th,
} from "@/components/ui";
import { JOURNEY } from "@/lib/data";
import { journeyFor } from "@/lib/journey";
import { Stepper } from "@/components/ui";
import { OpsButton, OpsGroup } from "@/components/Ops";
import { OpeningForm, PropertyForm } from "@/components/OpsForms";
import { RecordConsent } from "@/components/RecordConsent";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DOC_KINDS, listDocuments } from "@/lib/documents";
import { db, ensureData, getClient, invoicesFor, jobsFor, openingsFor, propertyFor, quotesFor } from "@/lib/db";
import { money, phoneDisplay, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const client = getClient(id);
  if (!client) notFound();
  const documents = await listDocuments(client.id);

  const prop = propertyFor(client.id);
  const quotes = quotesFor(client.id);
  const jobs = jobsFor(client.id);
  const invoices = invoicesFor(client.id);
  const openings = prop ? openingsFor(prop.id) : [];
  const conversation = db().conversations.find((c) => c.clientId === client.id);
  const lifetime = jobs.reduce((s, j) => s + j.contractCents, 0);
  const openBalance = invoices.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0);

  // Where they sit in the customer-facing journey — ours if we have a quote or
  // job for them, HubSpot's lead status and deal stage if we do not.
  const journey = journeyFor(client);

  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Clients
      </Link>

      <PageHeader
        title={client.name}
        subtitle={prop ? `${prop.address}, ${prop.city} ${prop.postalCode}` : "No property on file"}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/quotes/new" icon="file">New quote</LinkButton>
            {conversation && <LinkButton href={`/inbox/${conversation.id}`} variant="secondary" icon="mail">Message</LinkButton>}
          </div>
        }
      />

      <Panel className="mb-6">
        <SectionLabel>Where they are</SectionLabel>
        {journey.applicable ? (
          <>
            <Stepper steps={[...JOURNEY]} current={journey.current} />
            {journey.caption && (
              <p className="mt-3 text-xs text-ink-faint">
                {journey.caption}
                {journey.source === "crm" && " · from HubSpot"}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-dim">
            Not on the journey — HubSpot has this contact as{" "}
            <span className="text-ink">{journey.caption ?? "unqualified"}</span>.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionLabel>Client portal</SectionLabel>
            <p className="mb-3 text-xs leading-relaxed text-ink-dim">
              An account-free link to their own project. The link is the credential, so it is shown
              once and stored only as a hash — mint a new one rather than hunting for the old.
              To check what they are looking at, use the preview rather than opening a live link.
            </p>
            <OpsGroup>
              <LinkButton href={`/clients/${client.id}/portal`} variant="secondary" icon="eye">
                View their portal
              </LinkButton>
              <OpsButton input={{ kind: "portal.link", clientId: client.id }} variant="primary" icon="link">
                Create a link
              </OpsButton>
              <OpsButton input={{ kind: "portal.revoke", clientId: client.id }} variant="outline" confirm="Revoke all">
                Revoke existing
              </OpsButton>
            </OpsGroup>
          </Panel>

          <Panel>
            <SectionLabel>Documents on their portal</SectionLabel>
            <p className="mb-3 text-xs leading-relaxed text-ink-dim">
              The project plan, the itemized estimate, anything they should be able to open from their own link. The first PDF shows inline on their portal.
            </p>
            <DocumentUploader clientId={client.id} docs={documents} kindLabels={DOC_KINDS} />
          </Panel>

          <Panel>
            <SectionLabel>Service address</SectionLabel>
            {!prop && (
              <p className="mb-4 text-xs leading-relaxed text-warn">
                HubSpot has no street address for this contact, and nothing downstream can happen
                without one — a visit needs somewhere to go and a quote needs a property to price.
              </p>
            )}
            <PropertyForm
              clientId={client.id}
              current={prop ? {
                address: prop.address,
                city: prop.city,
                postalCode: prop.postalCode,
                floodZone: prop.floodZone,
                accessNotes: prop.accessNotes,
              } : undefined}
            />
          </Panel>

          {prop && (
            <Panel>
              <SectionLabel>Openings on this property</SectionLabel>
              {openings.length > 0 ? (
                <Table>
                  <thead><tr><Th>Opening</Th><Th>Type</Th><Th align="center">Width</Th><Th align="center">Protection height</Th><Th>Surface</Th><Th align="right"> </Th></tr></thead>
                  <tbody>
                    {openings.map((o) => (
                      <tr key={o.id} className="text-ink-dim">
                        <Td className="text-sm text-ink">{o.label}</Td>
                        <Td className="text-xs capitalize">{o.type.replace(/_/g, " ")}</Td>
                        <Td align="center" className="font-mono text-xs tabular-nums">
                          {o.widthIn}&quot;
                          {o.widthIn > 108 && <span className="ml-1 text-ember" title="Centre post required">•</span>}
                        </Td>
                        <Td align="center" className="font-mono text-xs tabular-nums">{o.protectionHeightIn}&quot;</Td>
                        <Td className="text-xs">{o.surface}</Td>
                        <Td align="right">
                          <OpsButton input={{ kind: "opening.remove", id: o.id }} variant="ghost" confirm="Remove">
                            Remove
                          </OpsButton>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-ink-dim">
                  Nothing measured yet. Openings are what a quote prices, so this is the assessment&apos;s output.
                </p>
              )}
              <div className="mt-5 border-t border-line pt-5">
                <OpeningForm propertyId={prop.id} />
              </div>
            </Panel>
          )}

          <Panel>
            <SectionLabel>Quotes</SectionLabel>
            {quotes.length === 0 ? <p className="text-sm text-ink-dim">None yet.</p> : (
              <ul className="flex flex-col gap-2">
                {quotes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">#{q.number} · {q.title}</span>
                        <span className="block text-xs text-ink-faint">{q.openings.length} openings · {shortDate(q.createdAt)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums text-ink">{money(q.totalCents)}</span>
                        <StatusPill status={q.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <SectionLabel>Jobs</SectionLabel>
            {jobs.length === 0 ? <p className="text-sm text-ink-dim">None yet.</p> : (
              <ul className="flex flex-col gap-2">
                {jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">#{j.number} · {j.title}</span>
                        <span className="block text-xs text-ink-faint">{shortDate(j.scheduledStart)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm tabular-nums text-ink">{money(j.contractCents)}</span>
                        <StatusPill status={j.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <SectionLabel>Invoices</SectionLabel>
            {invoices.length === 0 ? <p className="text-sm text-ink-dim">None raised.</p> : (
              <Table>
                <thead><tr><Th>Invoice</Th><Th>Due</Th><Th align="right">Total</Th><Th align="right">Balance</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="text-ink-dim">
                      <Td><Link href={`/invoices/${i.id}`} className="text-ink hover:text-teal">#{i.number}</Link></Td>
                      <Td className="text-xs">{shortDate(i.dueDate)}</Td>
                      <Td align="right" className="font-mono text-xs tabular-nums">{money(i.totalCents)}</Td>
                      <Td align="right" className="font-mono text-xs tabular-nums">{money(i.totalCents - i.amountPaidCents)}</Td>
                      <Td><StatusPill status={i.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionLabel>Contact</SectionLabel>
            <KeyValue
              rows={[
                ["Email", client.email ?? "—"],
                ["Phone", phoneDisplay(client.phone)],
                ["Type", client.type.replace(/_/g, " ")],
                ["Source", client.leadSource],
                ["Client since", shortDate(client.createdAt)],
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {client.tags.map((t) => <Badge key={t} tone="teal">{t}</Badge>)}
            </div>
          </Panel>

          <Panel>
            <SectionLabel>Consent</SectionLabel>
            <Badge tone={client.smsConsent ? "good" : "bad"}>
              {client.smsConsent
                ? client.smsMarketingConsent
                  ? "SMS consented, marketing included"
                  : "SMS consented, transactional only"
                : "No SMS consent on file"}
            </Badge>
            {client.smsConsentWording ? (
              <p className="mt-3 rounded-xl border border-line bg-abyss-2/60 p-3 text-xs leading-relaxed text-ink-dim">
                &ldquo;{client.smsConsentWording}&rdquo;
              </p>
            ) : (
              <p className="mt-3 text-xs text-ink-faint">
                Automations that require consent will skip this client. Transactional messages still send.
              </p>
            )}
            <RecordConsent clientId={client.id} hasPhone={Boolean(client.phone)} />
          </Panel>

          <Panel>
            <SectionLabel>Value</SectionLabel>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-dim">Lifetime contracted</span><Money cents={lifetime} /></div>
              <div className="flex justify-between"><span className="text-ink-dim">Open balance</span><Money cents={openBalance} tone={openBalance > 0 ? "bad" : "good"} /></div>
            </div>
          </Panel>

          {prop && (
            <Panel>
              <SectionLabel>Property</SectionLabel>
              <KeyValue
                rows={[
                  ["Flood zone", prop.floodZone ?? "Unknown"],
                  ["CRS class", prop.crsClass ? `Class ${prop.crsClass}` : "—"],
                  ["Access", prop.accessNotes ?? "Standard"],
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
