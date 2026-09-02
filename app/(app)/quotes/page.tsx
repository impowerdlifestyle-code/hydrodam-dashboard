import Link from "next/link";
import { EmptyState, PageHeader, Panel, RowLink, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { clientName, db, ensureData, liveRequests } from "@/lib/db";
import { compactMoney, money, relative, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotes · HydroDam Ops" };

const FILTERS = [
  { key: "open", label: "Open", match: ["draft", "sent", "viewed"] },
  { key: "won", label: "Won", match: ["approved", "converted"] },
  { key: "lost", label: "Lost", match: ["declined", "expired"] },
  { key: "all", label: "All", match: [] },
];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await ensureData();
  const { f = "open" } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
  const d = db();
  const rows = d.quotes
    .filter((q) => (filter.match.length ? filter.match.includes(q.status) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const open = d.quotes.filter((q) => ["draft", "sent", "viewed"].includes(q.status));
  const decided = d.quotes.filter((q) => ["approved", "converted", "declined", "expired"].includes(q.status));
  const won = decided.filter((q) => ["approved", "converted"].includes(q.status));
  // The calculator on thehydrodam.com prices a range before anyone here has
  // measured. Those are quotes in the customer's mind, so they belong on this
  // page even though nothing in `quotes` exists for them yet.
  const web = liveRequests()
    .filter((r) => r.estimateLowCents)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seen = new Set<string>();
  const webRows = web.filter((r) => (seen.has(r.clientId) ? false : (seen.add(r.clientId), true))).slice(0, 25);
  const webMonth = web.filter((r) => Date.now() - Date.parse(r.createdAt) < 30 * 86_400_000).length;

  return (
    <>
      <PageHeader
        title="Quotes"
        subtitle="Priced by opening — width, protection height and panel count."
        action={<Link href="/quotes/new" className="inline-flex items-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">New quote</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open value" value={compactMoney(open.reduce((s, q) => s + q.totalCents, 0))} sub={`${open.length} quotes out`} />
        <StatCard label="Close rate" value={`${decided.length ? Math.round((won.length / decided.length) * 100) : 0}%`} sub={`${won.length} of ${decided.length} decided`} accent="good" />
        <StatCard label="Average ticket" value={compactMoney(won.length ? Math.round(won.reduce((s, q) => s + q.totalCents, 0) / won.length) : 0)} accent="ember" />
      </div>

      <nav className="my-6 flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/quotes?f=${x.key}`}
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
          <EmptyState icon="file" title="No quotes here" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quote</Th>
                <Th>Client</Th>
                <Th>Series</Th>
                <Th align="center">Openings</Th>
                <Th align="right">Total</Th>
                <Th>Valid until</Th>
                <Th>Status</Th>
                <Th align="right">Sent</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                  <Td>
                    <RowLink href={`/quotes/${q.id}`}>
                      <span className="font-mono text-[11px] text-ink-faint">#{q.number}</span>
                      <span className="mt-0.5 block max-w-[16rem] truncate text-sm font-semibold">{q.title}</span>
                    </RowLink>
                  </Td>
                  <Td className="text-ink">{clientName(q.clientId)}</Td>
                  <Td className="text-xs capitalize">{q.primarySeries}</Td>
                  <Td align="center" className="font-mono text-xs tabular-nums">{q.openings.length}</Td>
                  <Td align="right" className="font-mono text-sm font-semibold tabular-nums text-ink">{money(q.totalCents)}</Td>
                  <Td className="text-xs">{shortDate(q.validUntil)}</Td>
                  <Td><StatusPill status={q.status} /></Td>
                  <Td align="right" className="font-mono text-xs">{q.sentAt ? relative(q.sentAt) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      <Panel className="mt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Website estimates · {webMonth} in the last 30 days</h2>
          <p className="text-xs text-ink-faint">Ranges the customer priced on thehydrodam.com. Open the request to measure and turn one into a real quote.</p>
        </div>
        {webRows.length === 0 ? (
          <EmptyState icon="file" title="No website estimates yet" />
        ) : (
          <Table compact>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>What they priced</Th>
                <Th>Range</Th>
                <Th>Status</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {webRows.map((r) => (
                <tr key={r.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                  <Td><RowLink href={`/requests/${r.id}`}><span className="text-sm font-semibold text-ink">{clientName(r.clientId)}</span></RowLink></Td>
                  <Td className="max-w-xs truncate text-xs">{r.title}</Td>
                  <Td className="font-mono text-xs tabular-nums text-ink">{money(r.estimateLowCents!)}–{money(r.estimateHighCents ?? 0)}</Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td align="right" className="font-mono text-xs">{relative(r.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
