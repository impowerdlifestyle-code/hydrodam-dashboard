import Link from "next/link";
import { EmptyState, PageHeader, Panel, RowLink, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { clientName, db, propertyFor, staffName } from "@/lib/db";
import { money, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests · HydroDam Ops" };

const FILTERS = [
  { key: "open", label: "Open", match: ["new", "contacted", "assessment_scheduled", "assessed"] },
  { key: "new", label: "New", match: ["new"] },
  { key: "booked", label: "Booked", match: ["assessment_scheduled", "assessed"] },
  { key: "closed", label: "Closed", match: ["converted", "unqualified"] },
  { key: "all", label: "All", match: [] },
];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "open" } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
  const rows = db()
    .requests.filter((r) => (filter.match.length ? filter.match.includes(r.status) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const all = db().requests;
  const slow = all.filter((r) => !r.firstResponseAt && r.status === "new").length;
  const responded = all.filter((r) => r.firstResponseAt);
  const medianMins = responded.length
    ? Math.round(
        responded
          .map((r) => (Date.parse(r.firstResponseAt!) - Date.parse(r.createdAt)) / 60_000)
          .sort((a, b) => a - b)[Math.floor(responded.length / 2)]
      )
    : 0;

  return (
    <>
      <PageHeader title="Requests" subtitle="Every inbound lead from the website, calculator and phone." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting first reply" value={slow} sub="speed to lead is the whole game" accent={slow ? "bad" : "good"} />
        <StatCard label="Median response" value={`${medianMins}m`} sub="from submission to first contact" />
        <StatCard label="Open requests" value={all.filter((r) => ["new", "contacted", "assessment_scheduled", "assessed"].includes(r.status)).length} accent="ember" />
      </div>

      <nav className="my-6 flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/requests?f=${x.key}`}
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
          <EmptyState icon="inbox" title="No requests here" body="New enquiries from thehydrodam.com land in this queue." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Client</Th>
                <Th>Source</Th>
                <Th>Ballpark</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th align="right">Age</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const prop = r.propertyId ? db().properties.find((p) => p.id === r.propertyId) : propertyFor(r.clientId);
                const late = !r.firstResponseAt && r.status === "new";
                return (
                  <tr key={r.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                    <Td>
                      <RowLink href={`/requests/${r.id}`}>
                        <span className="font-mono text-[11px] text-ink-faint">#{r.number}</span>
                        <span className="mt-0.5 block truncate text-sm font-semibold">{r.title}</span>
                      </RowLink>
                    </Td>
                    <Td>
                      <span className="text-ink">{clientName(r.clientId)}</span>
                      <span className="block text-xs text-ink-faint">{prop?.city ?? "—"}</span>
                    </Td>
                    <Td className="text-xs">{r.source}</Td>
                    <Td className="font-mono text-xs tabular-nums">
                      {r.estimateLowCents ? `${money(r.estimateLowCents)}–${money(r.estimateHighCents ?? 0)}` : "—"}
                    </Td>
                    <Td className="text-xs">{r.assignedTo ? staffName(r.assignedTo) : <span className="text-ember">Unassigned</span>}</Td>
                    <Td><StatusPill status={r.status} /></Td>
                    <Td align="right" className={`font-mono text-xs ${late ? "text-bad" : ""}`}>{relative(r.createdAt)}</Td>
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
