import Link from "next/link";
import { Bar, DemoNotice, EmptyState, PageHeader, Panel, RowLink, SectionLabel, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { arAging, clientName, collectedSince, db } from "@/lib/db";
import { compactMoney, money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices · HydroDam Ops" };

const FILTERS = [
  { key: "outstanding", label: "Outstanding", match: ["sent", "viewed", "partially_paid"] },
  { key: "overdue", label: "Overdue", match: [] },
  { key: "paid", label: "Paid", match: ["paid"] },
  { key: "all", label: "All", match: [] },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "outstanding" } = await searchParams;
  const d = db();
  const today = new Date().toISOString().slice(0, 10);

  let rows = d.invoices;
  if (f === "overdue") {
    rows = rows.filter((i) => ["sent", "viewed", "partially_paid"].includes(i.status) && (i.dueDate ?? "9999") < today);
  } else {
    const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];
    rows = filter.match.length ? rows.filter((i) => filter.match.includes(i.status)) : rows;
  }
  rows = [...rows].sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));

  const outstanding = d.invoices.filter((i) => ["sent", "viewed", "partially_paid"].includes(i.status));
  const overdue = outstanding.filter((i) => (i.dueDate ?? "9999") < today);
  const aging = arAging();
  const maxAging = Math.max(...aging.map((a) => a.cents), 1);
  const collected30 = collectedSince(30);

  return (
    <>
      <DemoNotice what="Invoices, payments and AR aging." />
      <PageHeader title="Invoices" subtitle="Deposits, progress payments and balances — card and ACH." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Outstanding" value={compactMoney(outstanding.reduce((s, i) => s + i.totalCents - i.amountPaidCents, 0))} sub={`${outstanding.length} open invoices`} />
        <StatCard label="Overdue" value={compactMoney(overdue.reduce((s, i) => s + i.totalCents - i.amountPaidCents, 0))} sub={`${overdue.length} past due`} accent={overdue.length ? "bad" : "good"} />
        <StatCard label="Collected, 30 days" value={compactMoney(collected30)} accent="good" />
      </div>

      <Panel className="mt-6">
        <SectionLabel>Accounts receivable aging</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-5">
          {aging.map((a) => (
            <div key={a.bucket}>
              <Bar label={a.bucket} value={a.cents} max={maxAging} hint={compactMoney(a.cents)} />
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{a.count} invoice{a.count === 1 ? "" : "s"}</p>
            </div>
          ))}
        </div>
      </Panel>

      <nav className="my-6 flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/invoices?f=${x.key}`}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              x.key === f ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon="dollar" title="Nothing here" body="Invoices are raised from a job's billing milestones." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Client</Th>
                <Th>Kind</Th>
                <Th>Due</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const balance = i.totalCents - i.amountPaidCents;
                const late = balance > 0 && (i.dueDate ?? "9999") < today;
                return (
                  <tr key={i.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                    <Td>
                      <RowLink href={`/invoices/${i.id}`}>
                        <span className="font-mono text-[11px] text-ink-faint">#{i.number}</span>
                        <span className="mt-0.5 block max-w-[15rem] truncate text-sm font-semibold">{i.title}</span>
                      </RowLink>
                    </Td>
                    <Td className="text-ink">{clientName(i.clientId)}</Td>
                    <Td className="text-xs capitalize">{i.kind}</Td>
                    <Td className={`text-xs ${late ? "font-semibold text-bad" : ""}`}>{shortDate(i.dueDate)}</Td>
                    <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(i.totalCents)}</Td>
                    <Td align="right" className={`font-mono text-sm tabular-nums ${balance > 0 ? (late ? "text-bad" : "text-warn") : "text-good"}`}>
                      {money(balance)}
                    </Td>
                    <Td><StatusPill status={i.status} /></Td>
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
