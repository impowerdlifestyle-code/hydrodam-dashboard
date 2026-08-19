import Link from "next/link";
import { Badge, PageHeader, Panel, RowLink, StatCard, Table, Td, Th } from "@/components/ui";
import { crmStatus, db, ensureData, invoicesFor, jobsFor, liveClients, propertyFor } from "@/lib/db";
import { compactMoney, money, phoneDisplay, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;
export const metadata = { title: "Clients · HydroDam Ops" };

const PAGE_SIZE = 100;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; addr?: string }>;
}) {
  await ensureData();
  const { q = "", p = "1", addr } = await searchParams;
  const crm = crmStatus();

  const needle = q.trim().toLowerCase();
  const matched = liveClients()
    .filter((c) => (addr === "1" ? Boolean(propertyFor(c.id)) : true))
    .filter((c) => (needle ? `${c.name} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase().includes(needle) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const page = Math.max(1, Number(p) || 1);
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const rows = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => ({
    c,
    value: jobsFor(c.id).reduce((s, j) => s + j.contractCents, 0),
    open: invoicesFor(c.id).reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0),
  }));
  const qs = (next: Record<string, string>) =>
    `/clients?${new URLSearchParams({ ...(q ? { q } : {}), ...(addr ? { addr } : {}), ...next }).toString()}`;

  const consented = matched.filter((c) => c.smsConsent).length;
  const addressed = crm.live ? crm.addressedCount ?? 0 : db().properties.length;

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={
          crm.live
            ? `Live from HubSpot — refreshed ${relative(crm.fetchedAt!)}.`
            : "Every property, job and dollar, by customer."
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Contacts" value={matched.length.toLocaleString()} sub={`${addressed.toLocaleString()} with an address on file`} />
        <StatCard
          label="Lifetime contracted"
          value={compactMoney(rows.reduce((s, x) => s + x.value, 0))}
          sub={crm.live ? "no closed-won deals in HubSpot" : undefined}
          accent={crm.live ? "teal" : "good"}
        />
        <StatCard
          label="SMS consented"
          value={`${consented.toLocaleString()}/${matched.length.toLocaleString()}`}
          sub={crm.live ? "HubSpot stores no consent record" : "TCPA wording stored per client"}
          accent={consented === matched.length ? "good" : "warn"}
        />
      </div>

      <nav className="my-6 flex flex-wrap items-center gap-2">
        <Link
          href={addr === "1" ? "/clients" : "/clients?addr=1"}
          className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            addr === "1" ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
          }`}
        >
          Has an address
        </Link>
        <form action="/clients" className="ml-auto flex items-center gap-2">
          {addr === "1" && <input type="hidden" name="addr" value="1" />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, email or phone…"
            className="w-56 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-bright focus:outline-none"
          />
        </form>
      </nav>

      <Panel>
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Location</Th>
              <Th>Zone</Th>
              <Th>Source</Th>
              <Th align="center">Jobs</Th>
              <Th align="right">Lifetime</Th>
              <Th align="right">Open balance</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, value, open }) => {
              const prop = propertyFor(c.id);
              return (
                <tr key={c.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                  <Td>
                    <RowLink href={`/clients/${c.id}`}>
                      <span className="block text-sm font-semibold">{c.name}</span>
                      <span className="block text-xs text-ink-faint">{phoneDisplay(c.phone)}</span>
                    </RowLink>
                  </Td>
                  <Td className="text-xs">{prop?.city ?? "—"}</Td>
                  <Td>{prop?.floodZone ? <Badge tone={prop.floodZone === "VE" ? "bad" : prop.floodZone === "X" ? "neutral" : "warn"}>{prop.floodZone}</Badge> : "—"}</Td>
                  <Td className="text-xs">{c.leadSource}</Td>
                  <Td align="center" className="font-mono text-xs tabular-nums">{jobsFor(c.id).length}</Td>
                  <Td align="right" className="font-mono text-sm tabular-nums text-ink">{value ? money(value) : "—"}</Td>
                  <Td align="right" className={`font-mono text-sm tabular-nums ${open > 0 ? "text-warn" : "text-ink-faint"}`}>{open > 0 ? money(open) : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
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
