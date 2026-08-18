import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, KeyValue, LinkButton, PageHeader, Panel, SectionLabel, StatusPill } from "@/components/ui";
import { db, ensureCrm, getClient, getRequest, propertyFor, staffName } from "@/lib/db";
import { dateTime, money, phoneDisplay, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  await ensureCrm();
  const { id } = await params;
  const r = getRequest(id);
  if (!r) notFound();

  const client = getClient(r.clientId);
  const prop = r.propertyId ? db().properties.find((p) => p.id === r.propertyId) : propertyFor(r.clientId);
  const responseMins = r.firstResponseAt
    ? Math.round((Date.parse(r.firstResponseAt) - Date.parse(r.createdAt)) / 60_000)
    : null;

  return (
    <>
      <Link href="/requests" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Requests
      </Link>

      <PageHeader
        title={r.title}
        subtitle={`Request #${r.number} · ${r.source} · ${relative(r.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/quotes/new?request=${r.id}`} icon="file">Build quote</LinkButton>
            <LinkButton href="/schedule" variant="secondary" icon="calendar">Book assessment</LinkButton>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionLabel>What they told us</SectionLabel>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{r.details ?? "No details supplied."}</p>
            {r.estimateLowCents ? (
              <div className="mt-4 rounded-xl border border-line bg-abyss-2/60 p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Calculator ballpark shown on site</p>
                <p className="mt-1 font-display text-xl font-bold text-teal">
                  {money(r.estimateLowCents)} – {money(r.estimateHighCents ?? 0)}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  A range, not a quote. The on-site assessment sets the real number.
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <SectionLabel>Property</SectionLabel>
            {prop ? (
              <KeyValue
                rows={[
                  ["Address", `${prop.address}, ${prop.city} ${prop.postalCode}`],
                  ["Flood zone", prop.floodZone ?? "Unknown"],
                  ["CRS class", prop.crsClass ? `Class ${prop.crsClass}` : "—"],
                  ["Access notes", prop.accessNotes ?? "—"],
                ]}
              />
            ) : (
              <p className="text-sm text-ink-dim">No property on file yet — captured at the assessment.</p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionLabel>Status</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={r.status} />
              {responseMins !== null && (
                <Badge tone={responseMins <= 5 ? "good" : "bad"}>{responseMins}m to first reply</Badge>
              )}
              {responseMins === null && r.status === "new" && <Badge tone="bad">No reply yet</Badge>}
            </div>
            <dl className="mt-4 flex flex-col gap-3">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Received</dt>
                <dd className="text-sm text-ink">{dateTime(r.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Owner</dt>
                <dd className="text-sm text-ink">{r.assignedTo ? staffName(r.assignedTo) : "Unassigned"}</dd>
              </div>
            </dl>
          </Panel>

          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Client
              </SectionLabel>
              <p className="font-display text-base font-semibold text-ink">{client.name}</p>
              <p className="mt-1 text-sm text-ink-dim">{client.email}</p>
              <p className="text-sm text-ink-dim">{phoneDisplay(client.phone)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={client.smsConsent ? "good" : "neutral"}>
                  {client.smsConsent ? "SMS consented" : "No SMS consent"}
                </Badge>
                {client.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
