import { Bar, SeedNotice, Money, PageHeader, Panel, SectionLabel, StatCard, Table, Td, Th } from "@/components/ui";
import { DB_LIVE, arAging, clientName, crewUtilization, db, jobCosting, metrics, revenueByMonth, sourcePerformance, ensureData } from "@/lib/db";
import { compactMoney, hoursMinutes, money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports · HydroDam Ops" };

export default async function ReportsPage() {
  await ensureData();
  const d = db();
  const m = metrics();
  const revenue = revenueByMonth(6);
  const maxRev = Math.max(...revenue.map((r) => Math.max(r.bookedCents, r.collectedCents)), 1);
  const sources = sourcePerformance();
  const maxSource = Math.max(...sources.map((s) => s.wonCents), 1);
  const aging = arAging();
  const maxAging = Math.max(...aging.map((a) => a.cents), 1);
  const util = crewUtilization();

  const finished = d.jobs
    .filter((j) => ["completed", "invoiced", "closed"].includes(j.status))
    .map((j) => ({ job: j, cost: jobCosting(j.id) }))
    .filter((x) => x.cost.laborCents + x.cost.materialCents > 0)
    .sort((a, b) => b.cost.marginBps - a.cost.marginBps);

  // Margin by series tells you which quote templates are underpriced.
  const bySeries = (["sentinel", "onyx", "titanium"] as const).map((series) => {
    const rows = d.jobs
      .map((j) => ({ j, q: d.quotes.find((q) => q.id === j.quoteId) }))
      .filter((x) => x.q?.primarySeries === series);
    const revenueCents = rows.reduce((s, x) => s + x.j.contractCents, 0);
    const profit = rows.reduce((s, x) => s + jobCosting(x.j.id).grossProfitCents, 0);
    return { series, count: rows.length, revenueCents, profit, marginBps: revenueCents ? Math.round((profit / revenueCents) * 10_000) : 0 };
  }).filter((r) => r.count > 0);

  return (
    <>
      <SeedNotice what="Every figure on this page, including margin by series." live={DB_LIVE} />
      <PageHeader title="Reports" subtitle="Where the money comes from, and where it leaks." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Close rate" value={`${m.closeRatePct}%`} accent="good" />
        <StatCard label="Average ticket" value={compactMoney(m.avgTicketCents)} />
        <StatCard label="Outstanding" value={compactMoney(m.outstandingCents)} accent={m.overdueCount ? "bad" : "teal"} />
        <StatCard label="Collected this month" value={compactMoney(m.collectedThisMonthCents)} accent="good" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Booked vs collected</SectionLabel>
          <div className="flex flex-col gap-3.5">
            {revenue.map((r) => (
              <div key={r.month} className="flex items-center gap-3">
                <span className="w-9 shrink-0 font-mono text-[11px] uppercase text-ink-faint">{r.month}</span>
                <span className="flex-1">
                  <span className="mb-1 block h-2 overflow-hidden rounded-full bg-white/5">
                    <span className="block h-full rounded-full bg-teal" style={{ width: `${(r.bookedCents / maxRev) * 100}%` }} />
                  </span>
                  <span className="block h-2 overflow-hidden rounded-full bg-white/5">
                    <span className="block h-full rounded-full bg-good" style={{ width: `${(r.collectedCents / maxRev) * 100}%` }} />
                  </span>
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">{compactMoney(r.bookedCents)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionLabel>Won revenue by lead source</SectionLabel>
          <div className="flex flex-col gap-3.5">
            {sources.map((s) => (
              <Bar key={s.source} label={`${s.source} · ${s.leads} leads`} value={s.wonCents} max={maxSource} hint={compactMoney(s.wonCents)} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Margin by series</SectionLabel>
          <Table compact>
            <thead><tr><Th>Series</Th><Th align="center">Jobs</Th><Th align="right">Revenue</Th><Th align="right">Gross profit</Th><Th align="right">Margin</Th></tr></thead>
            <tbody>
              {bySeries.map((r) => (
                <tr key={r.series} className="text-ink-dim">
                  <Td className="text-sm capitalize text-ink">{r.series}</Td>
                  <Td align="center" className="font-mono text-xs tabular-nums">{r.count}</Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{money(r.revenueCents)}</Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{money(r.profit)}</Td>
                  <Td align="right" className={`font-mono text-sm tabular-nums ${r.marginBps >= 4000 ? "text-good" : "text-warn"}`}>
                    {(r.marginBps / 100).toFixed(0)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-ink-faint">
            This is the number that changes pricing — it tells you which quote template is underpriced.
          </p>
        </Panel>

        <Panel>
          <SectionLabel>AR aging</SectionLabel>
          <div className="flex flex-col gap-3.5">
            {aging.map((a) => (
              <Bar key={a.bucket} label={`${a.bucket} · ${a.count} invoice${a.count === 1 ? "" : "s"}`} value={a.cents} max={maxAging} hint={compactMoney(a.cents)} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Job profitability</SectionLabel>
          <Table compact>
            <thead><tr><Th>Job</Th><Th align="right">Contract</Th><Th align="right">Cost</Th><Th align="right">Margin</Th></tr></thead>
            <tbody>
              {finished.map(({ job, cost }) => (
                <tr key={job.id} className="text-ink-dim">
                  <Td>
                    <span className="text-sm text-ink">#{job.number}</span>
                    <span className="block truncate text-xs text-ink-faint">{clientName(job.clientId)}</span>
                  </Td>
                  <Td align="right"><Money cents={cost.revenueCents} /></Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{money(cost.laborCents + cost.materialCents)}</Td>
                  <Td align="right" className={`font-mono text-sm tabular-nums ${cost.marginBps >= 4000 ? "text-good" : "text-warn"}`}>
                    {(cost.marginBps / 100).toFixed(0)}%
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel>
          <SectionLabel>Crew hours and labor cost</SectionLabel>
          <Table compact>
            <thead><tr><Th>Crew</Th><Th align="right">Hours</Th><Th align="right">Cost</Th></tr></thead>
            <tbody>
              {util.map((u) => (
                <tr key={u.staffId} className="text-ink-dim">
                  <Td className="text-sm text-ink">{u.name}</Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{hoursMinutes(u.minutes)}</Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{money(u.costCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
