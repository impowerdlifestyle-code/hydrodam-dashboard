import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, KeyValue, PageHeader, Panel, SectionLabel, StatusPill } from "@/components/ui";
import { OpsSelect } from "@/components/Ops";
import { PropertyForm, QuoteFromRequestForm, ScheduleVisitForm } from "@/components/OpsForms";
import { db, ensureData, getClient, getRequest, openingsFor, propertyFor, quoteFor, staffName } from "@/lib/db";
import { dateTime, money, phoneDisplay, relative } from "@/lib/format";
import type { RequestStatus } from "@/lib/types";

/** Only the moves 0001's status_transitions table will actually accept. */
const NEXT_STATUS: Record<RequestStatus, RequestStatus[]> = {
  new: ["contacted", "assessment_scheduled", "unqualified"],
  contacted: ["assessment_scheduled", "unqualified"],
  assessment_scheduled: ["assessed"],
  assessed: ["converted", "unqualified"],
  converted: [],
  unqualified: ["contacted"],
};

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const r = getRequest(id);
  if (!r) notFound();

  const client = getClient(r.clientId);
  const prop = r.propertyId ? db().properties.find((p) => p.id === r.propertyId) : propertyFor(r.clientId);
  const crew = db().staff.filter((s) => s.active);
  const openings = prop ? openingsFor(prop.id) : [];
  const existingQuote = quoteFor(r.id);
  const statusOptions = [r.status, ...NEXT_STATUS[r.status]];
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
            <SectionLabel>Next step</SectionLabel>
            {existingQuote ? (
              <p className="text-sm text-ink-dim">
                Quoted already —{" "}
                <Link href={`/quotes/${existingQuote.id}`} className="text-teal hover:underline">
                  quote #{existingQuote.number}
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    Book the assessment
                  </p>
                  <ScheduleVisitForm requestId={r.id} crew={crew} kinds={["assessment"]} />
                </div>
                <div>
                  <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                    Or price it now
                  </p>
                  <QuoteFromRequestForm requestId={r.id} openingCount={openings.length} />
                </div>
              </div>
            )}
          </Panel>

          <Panel>
            <SectionLabel>Property</SectionLabel>
            {prop ? (
              <>
                <KeyValue
                  rows={[
                    ["Address", `${prop.address}, ${prop.city} ${prop.postalCode}`],
                    ["Flood zone", prop.floodZone ?? "Unknown"],
                    ["CRS class", prop.crsClass ? `Class ${prop.crsClass}` : "—"],
                    ["Access notes", prop.accessNotes ?? "—"],
                  ]}
                />
                <p className="mt-4 text-xs text-ink-faint">
                  {openings.length} opening{openings.length === 1 ? "" : "s"} measured.{" "}
                  <Link href={`/clients/${r.clientId}`} className="text-teal hover:underline">
                    Measure the property
                  </Link>
                  .
                </p>
              </>
            ) : (
              <PropertyForm clientId={r.clientId} />
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
            <div className="mt-4 flex flex-col gap-3">
              {statusOptions.length > 1 ? (
                <OpsSelect
                  label="Move to"
                  input={{ kind: "request.status", id: r.id }}
                  field="status"
                  value={r.status}
                  options={statusOptions.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
                />
              ) : null}
              <OpsSelect
                label="Owner"
                input={{ kind: "request.assign", id: r.id }}
                field="userId"
                value={r.assignedTo ?? ""}
                options={[{ value: "", label: "Unassigned" }, ...crew.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Received</dt>
                <dd className="text-sm text-ink">{dateTime(r.createdAt)}</dd>
              </div>
            </div>
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
