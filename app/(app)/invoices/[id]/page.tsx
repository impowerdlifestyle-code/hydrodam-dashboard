import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, LinkButton, Money, PageHeader, Panel, SectionLabel, StatusPill, Table, Td, Th } from "@/components/ui";
import { clientName, daysOverdue, getClient, getInvoice, getJob, paymentsFor } from "@/lib/db";
import { money, shortDate, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = {
  card: "Card", ach: "Bank transfer (ACH)", check: "Check", cash: "Cash", wire: "Wire",
};

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = getInvoice(id);
  if (!inv) notFound();

  const client = getClient(inv.clientId);
  const job = inv.jobId ? getJob(inv.jobId) : undefined;
  const payments = paymentsFor(inv.id);
  const balance = inv.totalCents - inv.amountPaidCents;
  const today = new Date().toISOString().slice(0, 10);
  const late = balance > 0 && (inv.dueDate ?? "9999") < today;

  // Card fees are indefensible at this ticket size; the portal defaults to ACH.
  const cardFee = Math.round(balance * 0.029) + 30;

  return (
    <>
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Invoices
      </Link>

      <PageHeader
        title={`Invoice #${inv.number}`}
        subtitle={`${clientName(inv.clientId)} · issued ${shortDate(inv.issueDate)} · due ${shortDate(inv.dueDate)}`}
        action={
          <div className="flex flex-wrap gap-2">
            {balance > 0 && <LinkButton href={`/invoices/${inv.id}`} icon="send">Send reminder</LinkButton>}
            {job && <LinkButton href={`/jobs/${job.id}`} variant="outline" icon="wrench">Job #{job.number}</LinkButton>}
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusPill status={inv.status} />
        {late && <Badge tone="bad">{daysOverdue(inv.dueDate)} days overdue</Badge>}
        <Badge tone="teal">{inv.kind}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionLabel>Line items</SectionLabel>
            <Table>
              <thead><tr><Th>Item</Th><Th align="center">Qty</Th><Th align="right">Amount</Th></tr></thead>
              <tbody>
                {inv.lineItems.map((i) => (
                  <tr key={i.id} className="text-ink-dim">
                    <Td className="text-sm text-ink">{i.name}</Td>
                    <Td align="center" className="font-mono text-xs tabular-nums">{i.quantity}</Td>
                    <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(i.quantity * i.unitPriceCents, true)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="mt-5 ml-auto flex max-w-xs flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-dim">Subtotal</dt><dd><Money cents={inv.subtotalCents} exact /></dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Tax</dt><dd><Money cents={inv.taxCents} exact tone="dim" /></dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-display text-base font-bold"><dt>Total</dt><dd className="font-mono tabular-nums">{money(inv.totalCents, true)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-dim">Paid</dt><dd><Money cents={inv.amountPaidCents} exact tone="good" /></dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-bold">
                <dt>Balance</dt>
                <dd className={`font-mono tabular-nums ${balance > 0 ? "text-warn" : "text-good"}`}>{money(balance, true)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel>
            <SectionLabel>Payments</SectionLabel>
            {payments.length === 0 ? (
              <p className="text-sm text-ink-dim">Nothing received yet.</p>
            ) : (
              <Table>
                <thead><tr><Th>Received</Th><Th>Method</Th><Th>Status</Th><Th align="right">Fee</Th><Th align="right">Net</Th><Th align="right">Amount</Th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="text-ink-dim">
                      <Td className="text-xs">{shortDate(p.receivedOn)}</Td>
                      <Td className="text-xs">
                        {METHOD_LABEL[p.method]}
                        {p.last4 && <span className="ml-1 font-mono text-ink-faint">···{p.last4}</span>}
                      </Td>
                      <Td><StatusPill status={p.status} /></Td>
                      <Td align="right" className="font-mono text-xs tabular-nums text-bad">−{money(p.feeCents, true)}</Td>
                      <Td align="right" className="font-mono text-xs tabular-nums">{money(p.amountCents - p.feeCents, true)}</Td>
                      <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(p.amountCents, true)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {balance > 0 && (
            <Panel>
              <SectionLabel>Collect the balance</SectionLabel>
              <div className="flex flex-col gap-2">
                <div className="rounded-xl border border-good/30 bg-good/8 p-3">
                  <p className="flex items-center justify-between text-sm font-semibold text-good">
                    Bank transfer (ACH) <span className="font-mono">$5.00 fee</span>
                  </p>
                  <p className="mt-1 text-xs text-ink-dim">Recommended. Clears in 3–5 business days.</p>
                </div>
                <div className="rounded-xl border border-line p-3">
                  <p className="flex items-center justify-between text-sm text-ink-dim">
                    Card <span className="font-mono text-bad">{money(cardFee, true)} fee</span>
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">2.9% + 30¢. Instant, but it costs {money(cardFee - 500)} more than ACH on this balance.</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                Live payment links need Stripe connected to HydroDam&apos;s own account.
              </p>
            </Panel>
          )}

          <Panel>
            <SectionLabel>Timeline</SectionLabel>
            <dl className="flex flex-col gap-3">
              {([
                ["Issued", shortDate(inv.issueDate)],
                ["Sent", inv.sentAt ? dateTime(inv.sentAt) : "—"],
                ["Due", shortDate(inv.dueDate)],
                ["Paid", inv.paidAt ? dateTime(inv.paidAt) : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{k}</dt>
                  <dd className="text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Bill to
              </SectionLabel>
              <p className="font-display text-base font-semibold text-ink">{client.name}</p>
              <p className="mt-1 text-sm text-ink-dim">{client.email}</p>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
