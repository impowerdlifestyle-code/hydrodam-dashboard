import { Badge, PageHeader, Panel, RowLink, StatCard, Table, Td, Th } from "@/components/ui";
import { db, invoicesFor, jobsFor, propertyFor } from "@/lib/db";
import { compactMoney, money, phoneDisplay } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients · HydroDam Ops" };

export default function ClientsPage() {
  const d = db();
  const rows = [...d.clients].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lifetime = rows.map((c) => ({
    c,
    value: jobsFor(c.id).reduce((s, j) => s + j.contractCents, 0),
    open: invoicesFor(c.id).reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0),
  }));
  const consented = rows.filter((c) => c.smsConsent).length;

  return (
    <>
      <PageHeader title="Clients" subtitle="Every property, job and dollar, by customer." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Clients" value={rows.length} sub={`${d.properties.length} properties on file`} />
        <StatCard label="Lifetime contracted" value={compactMoney(lifetime.reduce((s, x) => s + x.value, 0))} accent="good" />
        <StatCard label="SMS consented" value={`${consented}/${rows.length}`} sub="TCPA wording stored per client" accent={consented === rows.length ? "good" : "warn"} />
      </div>

      <Panel className="mt-6">
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
            {lifetime.map(({ c, value, open }) => {
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
    </>
  );
}
