import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  Avatar, Badge, KeyValue, LinkButton, Money, PageHeader, Panel, ProgressBar, SectionLabel,
  StatusPill, Table, Td, Th,
} from "@/components/ui";
import { OpsButton, OpsGroup, OpsSelect } from "@/components/Ops";
import { RaiseInvoiceForm, ScheduleVisitForm } from "@/components/OpsForms";
import { QA_CHECKLIST, allFields } from "@/lib/forms";
import { clientName, db, getClient, getJob, getProperty, getQuote, getStaff, jobCosting, visitsForJob, ensureData } from "@/lib/db";
import { dateTime, hoursMinutes, longDate, money, shortDate, timeRange } from "@/lib/format";
import type { JobStatus } from "@/lib/types";

/** Mirrors 0001's status_transitions rows — anything else the database refuses. */
const NEXT_JOB_STATUS: Record<JobStatus, JobStatus[]> = {
  pending: ["scheduled"],
  scheduled: ["in_progress", "on_hold", "pending"],
  in_progress: ["completed", "on_hold"],
  on_hold: ["scheduled", "in_progress"],
  completed: ["invoiced", "in_progress"],
  invoiced: ["closed", "completed"],
  closed: [],
};

const FAB_STAGES = ["not_started", "cut_sheet_ready", "in_fabrication", "qc_passed", "ready_for_install"];

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  assessment: "Assessment", measure: "Measure", install: "Install",
  service: "Service", thirty_day_check: "30-day check",
};

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  const d = db();
  const client = getClient(job.clientId);
  const prop = getProperty(job.propertyId);
  const quote = job.quoteId ? getQuote(job.quoteId) : undefined;
  const visits = visitsForJob(job.id);
  const cost = jobCosting(job.id);
  const invoices = d.invoices.filter((i) => i.jobId === job.id);
  const materials = d.materials.filter((m) => m.jobId === job.id);
  const times = d.timeEntries.filter((t) => t.jobId === job.id);
  const checklist = d.submissions.find((s) => s.jobId === job.id && s.templateKey === "qa_checklist");

  const required = allFields(QA_CHECKLIST).filter((f) => f.required);
  const answered = checklist ? required.filter((f) => (checklist.answers[f.id] ?? "").trim()).length : 0;

  return (
    <>
      <Link href="/jobs" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Jobs
      </Link>

      <PageHeader
        title={`Job #${job.number}`}
        subtitle={`${clientName(job.clientId)} · ${prop?.address}, ${prop?.city} ${prop?.postalCode}`}
        action={
          <OpsGroup>
            {job.status === "completed" && (
              <OpsButton input={{ kind: "job.status", id: job.id, status: "invoiced" }} variant="primary" icon="dollar">
                Mark invoiced
              </OpsButton>
            )}
            {job.status === "invoiced" && (
              <OpsButton input={{ kind: "job.status", id: job.id, status: "closed" }} variant="primary" icon="check">
                Close the job
              </OpsButton>
            )}
            {visits[0] && <LinkButton href={`/field/visit/${visits[0].id}`} variant="secondary" icon="truck">Field view</LinkButton>}
            {quote && <LinkButton href={`/quotes/${quote.id}`} variant="outline" icon="file">Quote #{quote.number}</LinkButton>}
          </OpsGroup>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusPill status={job.status} />
        {job.warrantyEndsOn && <Badge tone="good">Warranty to {longDate(job.warrantyEndsOn)}</Badge>}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {NEXT_JOB_STATUS[job.status].length > 0 && (
          <OpsSelect
            label="Job status"
            input={{ kind: "job.status", id: job.id }}
            field="status"
            value={job.status}
            options={[job.status, ...NEXT_JOB_STATUS[job.status]].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))}
          />
        )}
        <OpsSelect
          label="Fabrication"
          input={{ kind: "job.fabrication", id: job.id }}
          field="stage"
          value={job.fabricationStatus}
          options={FAB_STAGES.map((v) => ({ value: v, label: v.replace(/_/g, " ") }))}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {job.instructions && (
            <Panel>
              <SectionLabel>Crew instructions</SectionLabel>
              <p className="text-sm leading-relaxed text-ink">{job.instructions}</p>
            </Panel>
          )}

          <Panel>
            <SectionLabel>Schedule a visit</SectionLabel>
            <ScheduleVisitForm
              jobId={job.id}
              crew={d.staff.filter((s) => s.active)}
              kinds={["install", "measure", "service", "thirty_day_check"]}
            />
          </Panel>

          <Panel>
            <SectionLabel>Visits</SectionLabel>
            <ul className="flex flex-col gap-2">
              {visits.map((v) => {
                const crew = v.assignedTo.map((sid) => getStaff(sid));
                return (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/12 font-mono text-[11px] font-bold text-teal">
                      {v.sequence}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{v.title}</span>
                      <span className="block text-xs text-ink-dim">
                        {shortDate(v.scheduledStart)} · {timeRange(v.scheduledStart, v.scheduledEnd)} · {KIND_LABEL[v.kind]}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      {crew.map((c) => c && <Avatar key={c.id} name={c.name} size={22} color={c.color} />)}
                    </span>
                    <StatusPill status={v.status} />
                  </li>
                );
              })}
              {visits.length === 0 && <p className="text-sm text-ink-dim">No visits scheduled yet.</p>}
            </ul>
          </Panel>

          <Panel>
            <SectionLabel action={checklist ? <StatusPill status={checklist.status === "submitted" ? "completed" : "in_progress"} /> : undefined}>
              Installation QA checklist
            </SectionLabel>
            {!checklist ? (
              <p className="text-sm text-ink-dim">Not started. The crew completes this on site before a job can be marked complete.</p>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <ProgressBar value={answered} max={required.length} tone={answered === required.length ? "good" : "warn"} />
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">{answered}/{required.length}</span>
                </div>
                <div className="flex flex-col gap-4">
                  {QA_CHECKLIST.map((group) => (
                    <div key={group.title}>
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-teal">{group.title}</p>
                      <ul className="flex flex-col gap-1">
                        {group.fields.map((f) => {
                          const val = checklist.answers[f.id];
                          const ok = Boolean(val && val.trim());
                          return (
                            <li key={f.id} className="flex items-start gap-2 text-xs">
                              <span className={`mt-0.5 shrink-0 ${ok ? "text-good" : "text-ink-faint"}`}>
                                <Icon name={ok ? "check" : "x"} size={12} />
                              </span>
                              <span className="flex-1 text-ink-dim">{f.label}</span>
                              {f.type !== "check" && val && <span className="shrink-0 font-mono text-ink">{val}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
                {checklist.submittedAt && (
                  <p className="mt-4 rounded-xl border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">
                    Signed off by {checklist.submittedByName} on {dateTime(checklist.submittedAt)}.
                  </p>
                )}
              </>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionLabel>Job costing</SectionLabel>
            <dl className="flex flex-col gap-2.5 text-sm">
              <Row label="Contract" value={<Money cents={cost.revenueCents} />} />
              <Row label="Labor" value={<Money cents={-cost.laborCents} tone="dim" />} hint={hoursMinutes(cost.laborMinutes)} />
              <Row label="Materials" value={<Money cents={-cost.materialCents} tone="dim" />} />
              <div className="my-1 border-t border-line" />
              <Row label="Gross profit" value={<Money cents={cost.grossProfitCents} tone={cost.marginBps >= 4000 ? "good" : "bad"} />} />
              <Row label="Margin" value={<span className={`font-mono ${cost.marginBps >= 4000 ? "text-good" : "text-warn"}`}>{(cost.marginBps / 100).toFixed(1)}%</span>} />
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <Row label="Invoiced" value={<Money cents={cost.invoicedCents} />} />
              <Row label="Collected" value={<Money cents={cost.collectedCents} tone="good" />} />
              <Row label="Outstanding" value={<Money cents={cost.invoicedCents - cost.collectedCents} tone={cost.invoicedCents > cost.collectedCents ? "bad" : undefined} />} />
            </div>
          </Panel>

          <Panel>
            <SectionLabel>Raise an invoice</SectionLabel>
            <RaiseInvoiceForm jobId={job.id} />
          </Panel>

          <Panel>
            <SectionLabel>Invoices</SectionLabel>
            {invoices.length === 0 ? (
              <p className="text-sm text-ink-dim">None raised yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                      <span>
                        <span className="block text-sm text-ink">#{i.number} · {i.kind}</span>
                        <span className="block text-xs text-ink-faint">due {shortDate(i.dueDate)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-mono text-sm tabular-nums text-ink">{money(i.totalCents)}</span>
                        <StatusPill status={i.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {materials.length > 0 && (
            <Panel>
              <SectionLabel>Materials consumed</SectionLabel>
              <Table compact>
                <thead><tr><Th>Item</Th><Th align="center">Qty</Th><Th align="right">Cost</Th></tr></thead>
                <tbody>
                  {materials.map((m) => (
                    <tr key={m.id} className="text-ink-dim">
                      <Td className="text-xs text-ink">{m.name}</Td>
                      <Td align="center" className="font-mono text-xs tabular-nums">{m.quantity} {m.unit}</Td>
                      <Td align="right" className="font-mono text-xs tabular-nums">{money(m.quantity * m.unitCostCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}

          {times.length > 0 && (
            <Panel>
              <SectionLabel>Time on this job</SectionLabel>
              <ul className="flex flex-col gap-2">
                {times.map((t) => {
                  const mins = t.endedAt
                    ? Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 - t.breakMinutes)
                    : 0;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 text-ink-dim">
                        <Avatar name={getStaff(t.userId)?.name ?? "?"} size={20} color={getStaff(t.userId)?.color} />
                        {getStaff(t.userId)?.name}
                        <span className="text-ink-faint">· {t.activity}</span>
                      </span>
                      <span className="font-mono tabular-nums text-ink">
                        {t.endedAt ? hoursMinutes(mins) : <span className="text-warn">running</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Client
              </SectionLabel>
              <KeyValue rows={[["Name", client.name], ["Flood zone", prop?.floodZone ?? "—"], ["Access", prop?.accessNotes ?? "Standard"]]} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-ink-dim">
        {label}
        {hint && <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{hint}</span>}
      </dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
