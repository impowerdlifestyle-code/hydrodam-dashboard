import { RefreshCrm } from "@/components/RefreshCrm";
import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, RowLink, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { OpsButton } from "@/components/Ops";
import { clientName, crmStatus, db, ensureData, liveRequests, propertyFor, requestRef, staffName } from "@/lib/db";
import { activeStaff, currentStaff } from "@/lib/whoami";
import { money, relative } from "@/lib/format";
import type { ServiceRequest } from "@/lib/types";

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

/** One line per person. The newest enquiry speaks for the group; the rest are counted. */
type Group = { lead: ServiceRequest; count: number; ballpark?: ServiceRequest };

function groupByClient(rows: ServiceRequest[]): Group[] {
  const by = new Map<string, Group>();
  for (const r of rows) {
    const g = by.get(r.clientId);
    if (!g) by.set(r.clientId, { lead: r, count: 1, ballpark: r.estimateLowCents ? r : undefined });
    else {
      g.count += 1;
      if (r.createdAt > g.lead.createdAt) g.lead = r;
      if (r.estimateLowCents && (!g.ballpark || r.createdAt > g.ballpark.createdAt)) g.ballpark = r;
    }
  }
  return [...by.values()].sort((a, b) => b.lead.createdAt.localeCompare(a.lead.createdAt));
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; p?: string; o?: string }>;
}) {
  await ensureData();
  const { f = "open", q = "", p = "1", o = "" } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
  const crm = crmStatus();
  const me = await currentStaff();
  const staff = activeStaff();
  const ownerId = o === "me" ? me?.id : o || undefined;

  const all = liveRequests();
  const needle = q.trim().toLowerCase();
  const matched = all
    .filter((r) => (filter.match.length ? filter.match.includes(r.status) : true))
    .filter((r) => (ownerId ? r.assignedTo === ownerId : o === "none" ? !r.assignedTo : true))
    .filter((r) => (needle ? `${r.title} ${clientName(r.clientId)}`.toLowerCase().includes(needle) : true));
  const groups = groupByClient(matched);

  const page = Math.max(1, Number(p) || 1);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const rows = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (next: Record<string, string>) =>
    `/requests?${new URLSearchParams({ f, ...(q ? { q } : {}), ...(o ? { o } : {}), ...next }).toString()}`;

  const people = groupByClient(all);
  const count = (statuses: string[]) => people.filter((g) => statuses.includes(g.lead.status)).length;
  const neverContacted = count(["new"]);
  const measurementBooked = count(["assessment_scheduled"]);
  const estimateStage = count(["assessed"]);
  const paid = count(["converted"]);
  const mine = me ? all.filter((r) => r.assignedTo === me.id && !["converted", "unqualified"].includes(r.status)).length : 0;

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle={
          crm.live
            ? `Live from HubSpot — ${crm.contactCount?.toLocaleString()} contacts, refreshed ${relative(crm.fetchedAt!)}. One line per person.`
            : "Every inbound lead from the website, calculator and phone. One line per person."
        }
        action={crm.live ? <RefreshCrm /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Never contacted" value={neverContacted} sub="still New in HubSpot" accent={neverContacted ? "bad" : "good"} href="/requests?f=new" />
        <StatCard label="Measurement booked" value={measurementBooked} sub="Measurement Scheduled in HubSpot" accent="teal" />
        <StatCard label="Estimate stage" value={estimateStage} sub="Estimate Needed, Pending or Created" accent="ember" />
        <StatCard label="Paid customers" value={paid} sub="Invoice Paid in HubSpot" accent="good" href="/clients?v=customers" />
      </div>

      <nav className="my-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/requests?f=${x.key}${q ? `&q=${encodeURIComponent(q)}` : ""}${o ? `&o=${o}` : ""}`}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              x.key === filter.key ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
        {me && (
          <Link
            href={`/requests?f=${f}&o=me`}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              o === "me" ? "bg-ember/15 text-ember ring-1 ring-ember/40" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            My queue{mine ? ` · ${mine}` : ""}
          </Link>
        )}
        <form action="/requests" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="f" value={f} />
          <select
            name="o"
            defaultValue={o}
            className="rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-xs text-ink focus:border-line-bright focus:outline-none"
            aria-label="Owner"
          >
            <option value="">Any owner</option>
            <option value="none">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name.split(" ")[0]}&apos;s queue</option>)}
          </select>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or enquiry…"
            className="w-48 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-bright focus:outline-none"
          />
          <button type="submit" className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint ring-1 ring-line hover:text-ink">Go</button>
        </form>
      </nav>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={o === "me" ? "Your queue is empty" : "No requests here"}
            body={o === "me" ? "Take a request from the list, or ask Mady to assign you some." : "New enquiries from thehydrodam.com land in this queue."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Latest enquiry</Th>
                <Th>Source</Th>
                <Th>Ballpark</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th align="right">Age</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lead: r, count: n, ballpark }) => {
                const prop = r.propertyId ? db().properties.find((x) => x.id === r.propertyId) : propertyFor(r.clientId);
                const late = r.status === "new";
                return (
                  <tr key={r.clientId} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                    <Td>
                      <RowLink href={`/requests/${r.id}`}>
                        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                          {clientName(r.clientId)}
                          {n > 1 && <Badge tone="teal">{n} enquiries</Badge>}
                        </span>
                        <span className="block text-xs text-ink-faint">{prop?.city ?? "—"}</span>
                      </RowLink>
                    </Td>
                    <Td>
                      <span className="font-mono text-[11px] text-ink-faint">{requestRef(r, "short")}</span>
                      <span className="mt-0.5 block max-w-xs truncate text-xs">{r.title}</span>
                    </Td>
                    <Td className="text-xs">{r.source}</Td>
                    <Td className="font-mono text-xs tabular-nums">
                      {ballpark?.estimateLowCents ? `${money(ballpark.estimateLowCents)}–${money(ballpark.estimateHighCents ?? 0)}` : "—"}
                    </Td>
                    <Td className="text-xs">
                      {r.assignedTo ? (
                        staffName(r.assignedTo)
                      ) : me && !["converted", "unqualified"].includes(r.status) ? (
                        <OpsButton input={{ kind: "request.assign", id: r.id, userId: me.id }} size="sm" variant="ghost">Take</OpsButton>
                      ) : (
                        <span className="text-ember">Unassigned</span>
                      )}
                    </Td>
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
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, groups.length).toLocaleString()} of{" "}
            {groups.length.toLocaleString()} people
          </span>
          <span className="flex gap-2">
            {page > 1 && <Link href={qs({ p: String(page - 1) })} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">Previous</Link>}
            {page < pages && <Link href={qs({ p: String(page + 1) })} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">Next</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
