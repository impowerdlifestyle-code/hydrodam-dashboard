import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge, KeyValue, LinkButton, Money, PageHeader, Panel, SectionLabel, StatusPill, Table, Td, Th,
} from "@/components/ui";
import { OpsButton, OpsGroup } from "@/components/Ops";
import { ApproveQuoteForm } from "@/components/OpsForms";
import { clientName, db, getClient, getProperty, getQuote, ensureData } from "@/lib/db";
import { AGREEMENT_VERSION } from "@/lib/agreement";
import { dateTime, money, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const q = getQuote(id);
  if (!q) notFound();

  const client = getClient(q.clientId);
  const prop = getProperty(q.propertyId);
  const job = db().jobs.find((j) => j.quoteId === q.id);
  const materialCost = q.lineItems.reduce((s, i) => s + i.quantity * i.unitCostCents, 0);
  const marginBps = q.totalCents ? Math.round(((q.totalCents - materialCost) / q.totalCents) * 10_000) : 0;

  return (
    <>
      <Link href="/quotes" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Quotes
      </Link>

      <PageHeader
        title={`Quote #${q.number}`}
        subtitle={`${clientName(q.clientId)} · ${prop?.address}, ${prop?.city}`}
        action={
          <OpsGroup>
            {q.status === "draft" && (
              <OpsButton input={{ kind: "quote.send", id: q.id }} variant="primary" icon="send">
                Mark as sent
              </OpsButton>
            )}
            {(q.status === "sent" || q.status === "viewed") && (
              <OpsButton input={{ kind: "quote.decline", id: q.id }} variant="outline" confirm="Confirm declined">
                Declined
              </OpsButton>
            )}
            {q.status === "approved" && !job && (
              <OpsButton input={{ kind: "quote.job", id: q.id }} variant="primary" icon="wrench">
                Convert to job
              </OpsButton>
            )}
            {job && <LinkButton href={`/jobs/${job.id}`} variant="secondary" icon="wrench">Open job #{job.number}</LinkButton>}
          </OpsGroup>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionLabel>Openings priced</SectionLabel>
            <Table>
              <thead>
                <tr>
                  <Th>Opening</Th>
                  <Th align="center">Size (in)</Th>
                  <Th align="center">Planks</Th>
                  <Th align="center">Posts</Th>
                  <Th align="right">Price</Th>
                </tr>
              </thead>
              <tbody>
                {q.openings.map((o) => (
                  <tr key={o.id} className="text-ink-dim">
                    <Td>
                      <span className="text-sm text-ink">{o.label}</span>
                      <span className="block text-xs capitalize text-ink-faint">{o.type.replace(/_/g, " ")} · {o.series}</span>
                    </Td>
                    <Td align="center" className="font-mono text-xs tabular-nums">{o.widthIn} × {o.protectionHeightIn}</Td>
                    <Td align="center" className="font-mono text-xs tabular-nums">{o.panelCount}</Td>
                    <Td align="center" className="font-mono text-xs tabular-nums">
                      {o.postCount}
                      {o.centerPostRequired && <span className="ml-1 text-ember" title="Centre post required over 9 ft">•</span>}
                    </Td>
                    <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(o.lineTotalCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {q.openings.some((o) => o.centerPostRequired) && (
              <p className="mt-3 text-xs text-ember">• Centre post required — opening exceeds 9 ft.</p>
            )}
          </Panel>

          <Panel>
            <SectionLabel>Line items</SectionLabel>
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th align="center">Qty</Th>
                  <Th align="right">Unit</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {q.lineItems.map((i) => (
                  <tr key={i.id} className="text-ink-dim">
                    <Td>
                      <span className="text-sm text-ink">{i.name}</span>
                      {!i.taxable && <span className="ml-2 font-mono text-[10px] uppercase text-ink-faint">non-taxable</span>}
                    </Td>
                    <Td align="center" className="font-mono text-xs tabular-nums">{i.quantity}</Td>
                    <Td align="right" className="font-mono text-xs tabular-nums">{money(i.unitPriceCents)}</Td>
                    <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(i.quantity * i.unitPriceCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <dl className="mt-5 ml-auto flex max-w-xs flex-col gap-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-dim">Subtotal</dt><dd><Money cents={q.subtotalCents} exact /></dd></div>
              {q.discountCents > 0 && (
                <div className="flex justify-between"><dt className="text-ink-dim">Discount</dt><dd><Money cents={-q.discountCents} exact tone="good" /></dd></div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-dim">Sales tax</dt>
                <dd><Money cents={q.taxCents} exact tone="dim" /></dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-display text-lg font-bold">
                <dt>Total</dt><dd className="font-mono tabular-nums text-teal">{money(q.totalCents, true)}</dd>
              </div>
              <div className="flex justify-between text-xs text-ink-faint">
                <dt>Deposit due on approval ({q.depositPercentBps / 100}%)</dt>
                <dd className="font-mono tabular-nums">{money(q.depositDueCents)}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
              Treated as a lump-sum improvement to real property, so no sales tax is charged to the customer
              and the tax paid on materials is carried as a job cost.
            </p>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionLabel>Status</SectionLabel>
            <StatusPill status={q.status} />
            <dl className="mt-4 flex flex-col gap-3">
              {([
                ["Created", dateTime(q.createdAt)],
                ["Sent", q.sentAt ? dateTime(q.sentAt) : "—"],
                ["First viewed", q.viewedAt ? dateTime(q.viewedAt) : "—"],
                ["Approved", q.approvedAt ? dateTime(q.approvedAt) : "—"],
                ["Valid until", shortDate(q.validUntil)],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{k}</dt>
                  <dd className="text-sm text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {q.approvedByName && (
              <p className="mt-4 rounded-xl border border-good/30 bg-good/10 px-3 py-2 text-xs text-good">
                Signed by {q.approvedByName}. Agreement version {AGREEMENT_VERSION}, IP and user agent recorded.
              </p>
            )}
          </Panel>

          {["draft", "sent", "viewed"].includes(q.status) && (
            <Panel>
              <SectionLabel>Record the approval</SectionLabel>
              <ApproveQuoteForm quoteId={q.id} suggested={client?.name ?? ""} />
            </Panel>
          )}

          <Panel>
            <SectionLabel>Margin at quote</SectionLabel>
            <KeyValue
              rows={[
                ["Contract", money(q.totalCents)],
                ["Est. cost", money(materialCost)],
                ["Gross profit", <span key="gp" className={marginBps >= 4000 ? "text-good" : "text-warn"}>{money(q.totalCents - materialCost)}</span>],
                ["Margin", <span key="m" className={marginBps >= 4000 ? "text-good" : "text-warn"}>{(marginBps / 100).toFixed(0)}%</span>],
              ]}
            />
          </Panel>

          {client && (
            <Panel>
              <SectionLabel action={<Link href={`/clients/${client.id}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
                Client
              </SectionLabel>
              <p className="font-display text-base font-semibold text-ink">{client.name}</p>
              <p className="mt-1 text-sm text-ink-dim">{client.email}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="teal">{client.leadSource}</Badge>
                {client.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
