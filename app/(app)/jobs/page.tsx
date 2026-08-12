import Link from "next/link";
import { EmptyState, PageHeader, Panel, RowLink, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { clientName, db, jobCosting, propertyFor } from "@/lib/db";
import { compactMoney, money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs · HydroDam Ops" };

const FILTERS = [
  { key: "active", label: "Active", match: ["pending", "scheduled", "in_progress", "on_hold"] },
  { key: "done", label: "Completed", match: ["completed", "invoiced", "closed"] },
  { key: "all", label: "All", match: [] },
];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "active" } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
  const d = db();
  const rows = d.jobs
    .filter((j) => (filter.match.length ? filter.match.includes(j.status) : true))
    .sort((a, b) => (b.scheduledStart ?? "").localeCompare(a.scheduledStart ?? ""));

  const active = d.jobs.filter((j) => ["pending", "scheduled", "in_progress", "on_hold"].includes(j.status));
  const closed = d.jobs.filter((j) => ["completed", "invoiced", "closed"].includes(j.status));
  const margins = closed.map((j) => jobCosting(j.id)).filter((c) => c.revenueCents > 0);
  const avgMargin = margins.length ? Math.round(margins.reduce((s, c) => s + c.marginBps, 0) / margins.length) : 0;

  return (
    <>
      <PageHeader title="Jobs" subtitle="Work orders from fabrication through installation and sign-off." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active jobs" value={active.length} sub={compactMoney(active.reduce((s, j) => s + j.contractCents, 0)) + " under contract"} />
        <StatCard label="In fabrication" value={d.jobs.filter((j) => j.fabricationStatus === "in_fabrication").length} accent="ember" />
        <StatCard label="Average margin" value={`${(avgMargin / 100).toFixed(0)}%`} sub={`across ${margins.length} finished jobs`} accent={avgMargin >= 4000 ? "good" : "warn"} />
      </div>

      <nav className="my-6 flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/jobs?f=${x.key}`}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              x.key === filter.key ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon="wrench" title="No jobs here" body="Approved quotes convert into jobs automatically." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Client</Th>
                <Th>Fabrication</Th>
                <Th>Scheduled</Th>
                <Th align="right">Contract</Th>
                <Th align="right">Margin</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const c = jobCosting(j.id);
                const hasCost = c.laborCents + c.materialCents > 0;
                return (
                  <tr key={j.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                    <Td>
                      <RowLink href={`/jobs/${j.id}`}>
                        <span className="font-mono text-[11px] text-ink-faint">#{j.number}</span>
                        <span className="mt-0.5 block max-w-[15rem] truncate text-sm font-semibold">{j.title}</span>
                      </RowLink>
                    </Td>
                    <Td>
                      <span className="text-ink">{clientName(j.clientId)}</span>
                      <span className="block text-xs text-ink-faint">{propertyFor(j.clientId)?.city}</span>
                    </Td>
                    <Td><StatusPill status={j.fabricationStatus} /></Td>
                    <Td className="text-xs">{shortDate(j.scheduledStart)}</Td>
                    <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(j.contractCents)}</Td>
                    <Td align="right" className={`font-mono text-sm tabular-nums ${!hasCost ? "text-ink-faint" : c.marginBps >= 4000 ? "text-good" : "text-warn"}`}>
                      {hasCost ? `${(c.marginBps / 100).toFixed(0)}%` : "—"}
                    </Td>
                    <Td><StatusPill status={j.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
