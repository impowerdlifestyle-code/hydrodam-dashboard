import Link from "next/link";
import { EmptyState, PageHeader, Panel, RowLink, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { clientName, crmStatus, db, ensureData, liveRequests, propertyFor, staffName } from "@/lib/db";
import { money, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;
export const metadata = { title: "Requests · HydroDam Ops" };

const FILTERS = [
  { key: "open", label: "Open", match: ["new", "contacted", "assessment_scheduled", "assessed"] },
  { key: "new", label: "New", match: ["new"] },
  { key: "booked", label: "Booked", match: ["assessment_scheduled", "assessed"] },
  { key: "closed", label: "Closed", match: ["converted", "unqualified"] },
  { key: "all", label: "All", match: [] },
];

const PAGE_SIZE = 100;

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; p?: string }>;
}) {
  await ensureData();
  const { f = "open", q = "", p = "1" } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
  const crm = crmStatus();

  const all = liveRequests();
  const needle = q.trim().toLowerCase();
  const matched = all
    .filter((r) => (filter.match.length ? filter.match.includes(r.status) : true))
    .filter((r) => (needle ? `${r.title} ${clientName(r.clientId)}`.toLowerCase().includes(needle) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const page = Math.max(1, Number(p) || 1);
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const rows = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (next: Record<string, string>) =>
    `/requests?${new URLSearchParams({ f, ...(q ? { q } : {}), ...next }).toString()}`;

  const awaiting = all.filter((r) => r.status === "new").length;
  const contacted = all.filter((r) => r.firstResponseAt);
  const medianMins = contacted.length
    ? Math.round(
        contacted
          .map((r) => (Date.parse(r.firstResponseAt!) - Date.parse(r.createdAt)) / 60_000)
          .sort((a, b) => a - b)[Math.floor(contacted.length / 2)]
      )
    : 0;
  const medianDays = Math.round(medianMins / 1440);

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle={
          crm.live
            ? `Live from HubSpot — ${crm.contactCount?.toLocaleString()} contacts, refreshed ${relative(crm.fetchedAt!)}.`
            : "Every inbound lead from the website, calculator and phone."
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Never contacted"
          value={awaiting}
          sub="lead status is still NEW in HubSpot"
          accent={awaiting ? "bad" : "good"}
        />
        <StatCard
          label={crm.live ? "Median lead → last contact" : "Median response"}
          value={crm.live ? `${medianDays}d` : `${medianMins}m`}
          sub={crm.live ? "HubSpot records last contact, not first" : "from submission to first contact"}
        />
        <StatCard label="Open requests" value={matched.length} sub={`${filter.label.toLowerCase()} · showing ${rows.length}`} accent="ember" />
      </div>

      <nav className="my-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/requests?f=${x.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              x.key === filter.key ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
        <form action="/requests" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="f" value={f} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or enquiry…"
            className="w-56 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-bright focus:outline-none"
          />
        </form>
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
                const prop = r.propertyId ? db().properties.find((x) => x.id === r.propertyId) : propertyFor(r.clientId);
                const late = r.status === "new";
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

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-xs text-ink-faint">
          <span className="font-mono">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, matched.length).toLocaleString()} of{" "}
            {matched.length.toLocaleString()}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link href={qs({ p: String(page - 1) })} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={qs({ p: String(page + 1) })} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </>
  );
}
