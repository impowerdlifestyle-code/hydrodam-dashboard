import Link from "next/link";
import { getCrmSummary, fmtUSD } from "@/lib/hubspot";
import { PageHeader, StatCard, Panel, Badge, ConnectionPill } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const crm = await getCrmSummary();
  const maxStage = Math.max(1, ...crm.pipeline.map((p) => p.value));

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your pipeline, tasks, and team at a glance."
        action={<ConnectionPill connected={crm.connected} />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={fmtUSD(crm.metrics.openValue)} sub={`${crm.metrics.openDeals} active deals`} />
        <StatCard label="Won (recent)" value={fmtUSD(crm.metrics.wonValue)} accent="good" sub="closed revenue" />
        <StatCard label="New contacts" value={crm.metrics.newContacts30d} accent="ember" sub="last 30 days" />
        <StatCard label="Close rate" value={`${crm.metrics.closeRate}%`} sub="won / decided" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink">Pipeline by stage</h2>
            <Link href="/crm" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">View CRM →</Link>
          </div>
          <div className="mt-5 space-y-3.5">
            {crm.pipeline.length === 0 && <p className="text-sm text-ink-faint">No open deals.</p>}
            {crm.pipeline.map((p) => (
              <div key={p.stage}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-dim">{p.stage}</span>
                  <span className="font-mono text-ink">{fmtUSD(p.value)} <span className="text-ink-faint">· {p.count}</span></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-abyss">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal to-teal-2" style={{ width: `${(p.value / maxStage) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-lg font-bold text-ink">Today&apos;s tasks</h2>
          <div className="mt-4 space-y-2.5">
            {crm.tasks.length === 0 && <p className="text-sm text-ink-faint">Tasks sync from HubSpot once connected.</p>}
            {crm.tasks.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-xl border border-line bg-abyss/40 p-3">
                <Icon name="clock" size={16} className="mt-0.5 text-ember" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{t.title}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">{t.due}</p>
                </div>
              </div>
            ))}
          </div>
          <Link href="/copilot" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-teal/15 py-2.5 text-sm font-semibold text-teal ring-1 ring-line-bright transition-colors hover:bg-teal/20">
            <Icon name="spark" size={16} /> Ask the AI Copilot
          </Link>
        </Panel>
      </div>

      <Panel className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Recent contacts</h2>
          <Link href="/crm" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">All contacts →</Link>
        </div>
        <div className="mt-4 divide-y divide-line">
          {crm.contacts.slice(0, 6).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                <p className="truncate text-xs text-ink-faint">{c.email}</p>
              </div>
              {c.stage && <Badge tone="teal">{c.stage}</Badge>}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
