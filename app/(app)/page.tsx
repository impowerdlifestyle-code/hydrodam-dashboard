import Link from "next/link";
import { Icon } from "@/components/Icon";
import {
  AvatarStack, Bar, ConnectionPill, EmptyState, LinkButton, Money, PageHeader, Panel,
  SectionLabel, StatCard, StatusPill,
} from "@/components/ui";
import {
  DB_LIVE, clientName, db, getStaff, metrics, propertyFor, revenueByMonth, todaysVisits,
} from "@/lib/db";
import { compactMoney, money, relative, timeRange } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview · HydroDam Ops" };

export default function OverviewPage() {
  const d = db();
  const m = metrics();
  const today = todaysVisits();
  const revenue = revenueByMonth(6);
  const maxRevenue = Math.max(...revenue.map((r) => Math.max(r.bookedCents, r.collectedCents)), 1);

  const needsAttention = [
    ...d.requests
      .filter((r) => r.status === "new")
      .map((r) => ({
        key: `req-${r.id}`,
        icon: "inbox" as const,
        tone: "ember" as const,
        title: `New request from ${clientName(r.clientId)}`,
        detail: `${r.source} · ${relative(r.createdAt)}`,
        href: `/requests/${r.id}`,
      })),
    ...d.conversations
      .filter((c) => c.unreadCount > 0)
      .map((c) => ({
        key: `msg-${c.id}`,
        icon: "mail" as const,
        tone: "warn" as const,
        title: `${c.unreadCount} unread from ${clientName(c.clientId)}`,
        detail: `${c.channel.toUpperCase()} · ${relative(c.lastMessageAt)}`,
        href: `/inbox/${c.id}`,
      })),
    ...d.invoices
      .filter((i) => ["sent", "viewed", "partially_paid"].includes(i.status) && (i.dueDate ?? "9999") < new Date().toISOString().slice(0, 10))
      .map((i) => ({
        key: `inv-${i.id}`,
        icon: "dollar" as const,
        tone: "bad" as const,
        title: `Invoice #${i.number} overdue — ${money(i.totalCents - i.amountPaidCents)}`,
        detail: `${clientName(i.clientId)} · due ${i.dueDate}`,
        href: `/invoices/${i.id}`,
      })),
    ...d.visits
      .filter((v) => v.status === "unscheduled")
      .map((v) => ({
        key: `vis-${v.id}`,
        icon: "calendar" as const,
        tone: "ember" as const,
        title: `Unscheduled: ${v.title}`,
        detail: clientName(v.clientId),
        href: "/schedule",
      })),
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Everything moving through the business right now."
        action={<ConnectionPill connected={DB_LIVE} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open pipeline" value={compactMoney(m.openPipelineCents)} sub={`${m.openQuoteCount} live quotes`} href="/quotes" />
        <StatCard label="Won this month" value={compactMoney(m.wonThisMonthCents)} sub={`${m.closeRatePct}% close rate`} accent="good" />
        <StatCard label="Outstanding" value={compactMoney(m.outstandingCents)} sub={m.overdueCount ? `${money(m.overdueCents)} overdue` : "nothing overdue"} accent={m.overdueCount ? "bad" : "teal"} href="/invoices" />
        <StatCard label="Active jobs" value={m.activeJobs} sub={`${m.visitsToday} visits today`} accent="ember" href="/jobs" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* today */}
        <Panel className="lg:col-span-3">
          <SectionLabel action={<Link href="/schedule" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Full schedule</Link>}>
            Today on the board
          </SectionLabel>
          {today.length === 0 ? (
            <EmptyState icon="calendar" title="Nothing scheduled today" body="Drag a job onto the dispatch board to fill the day." action={<LinkButton href="/schedule" size="sm" variant="secondary">Open schedule</LinkButton>} />
          ) : (
            <ul className="flex flex-col gap-2">
              {today.map((v) => {
                const prop = propertyFor(v.clientId);
                const crew = v.assignedTo.map((id) => getStaff(id));
                return (
                  <li key={v.id}>
                    <Link href={v.jobId ? `/jobs/${v.jobId}` : "/schedule"} className="flex items-center gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                      <span className="w-20 shrink-0 font-mono text-[11px] tabular-nums text-teal">{timeRange(v.scheduledStart, v.scheduledEnd)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{clientName(v.clientId)}</span>
                        <span className="block truncate text-xs text-ink-dim">
                          {v.title} · {prop?.city}
                        </span>
                      </span>
                      <AvatarStack names={crew.map((c) => c?.name ?? "?")} colors={crew.map((c) => c?.color ?? "")} />
                      <StatusPill status={v.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* needs attention */}
        <Panel className="lg:col-span-2">
          <SectionLabel>Needs you</SectionLabel>
          {needsAttention.length === 0 ? (
            <EmptyState icon="check" title="All clear" body="No new requests, unread messages or overdue invoices." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {needsAttention.slice(0, 7).map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/5">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      a.tone === "bad" ? "bg-bad/15 text-bad" : a.tone === "warn" ? "bg-warn/15 text-warn" : "bg-ember/15 text-ember"
                    }`}>
                      <Icon name={a.icon} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{a.title}</span>
                      <span className="block truncate text-xs text-ink-faint">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {m.slowResponses > 0 && (
            <p className="mt-3 rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-xs text-ember">
              <strong>{m.slowResponses}</strong> {m.slowResponses === 1 ? "lead" : "leads"} waited more than 5 minutes for a first reply.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Booked vs collected, last 6 months</SectionLabel>
          <div className="flex flex-col gap-3.5">
            {revenue.map((r) => (
              <div key={r.month} className="flex items-center gap-3">
                <span className="w-9 shrink-0 font-mono text-[11px] uppercase text-ink-faint">{r.month}</span>
                <span className="flex-1">
                  <span className="mb-1 block h-2 overflow-hidden rounded-full bg-white/5">
                    <span className="block h-full rounded-full bg-teal" style={{ width: `${Math.round((r.bookedCents / maxRevenue) * 100)}%` }} />
                  </span>
                  <span className="block h-2 overflow-hidden rounded-full bg-white/5">
                    <span className="block h-full rounded-full bg-good" style={{ width: `${Math.round((r.collectedCents / maxRevenue) * 100)}%` }} />
                  </span>
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">{compactMoney(r.bookedCents)}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 flex gap-4 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" /> Booked</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" /> Collected</span>
          </p>
        </Panel>

        <Panel>
          <SectionLabel action={<Link href="/quotes" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">All quotes</Link>}>
            Pipeline by stage
          </SectionLabel>
          <div className="flex flex-col gap-3.5">
            {(["draft", "sent", "viewed", "approved", "converted"] as const).map((stage) => {
              const rows = d.quotes.filter((q) => q.status === stage);
              const value = rows.reduce((s, q) => s + q.totalCents, 0);
              const max = Math.max(...(["draft", "sent", "viewed", "approved", "converted"] as const).map((st) => d.quotes.filter((q) => q.status === st).reduce((s, q) => s + q.totalCents, 0)), 1);
              return <Bar key={stage} label={`${stage[0].toUpperCase()}${stage.slice(1)} · ${rows.length}`} value={value} max={max} hint={compactMoney(value)} />;
            })}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Average ticket</p>
              <p className="mt-1 font-display text-lg font-bold text-ink"><Money cents={m.avgTicketCents} /></p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Collected this month</p>
              <p className="mt-1 font-display text-lg font-bold text-good">{money(m.collectedThisMonthCents)}</p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
