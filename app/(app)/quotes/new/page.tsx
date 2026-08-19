import Link from "next/link";
import { Badge, PageHeader, Panel, SectionLabel, Table, Td, Th } from "@/components/ui";
import { db, getRequest, propertyFor, ensureData } from "@/lib/db";
import {
  DEPLOY_KIT_PER_OPENING_CENTS, INSTALL_PER_OPENING_CENTS, PANEL_HEIGHT_IN,
  POST_COST_EACH_CENTS, SERIES_RATE_PER_SQFT_CENTS, panelCountFor, priceOpening,
} from "@/lib/pricing";
import { QuoteFromRequestForm } from "@/components/OpsForms";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "New quote · HydroDam Ops" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  await ensureData();
  const { request } = await searchParams;
  const req = request ? getRequest(request) : undefined;
  const prop = req ? propertyFor(req.clientId) : undefined;
  const openings = prop ? db().openings.filter((o) => o.propertyId === prop.id) : [];

  return (
    <>
      <Link href="/quotes" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Quotes
      </Link>

      <PageHeader
        title="New quote"
        subtitle={req ? `From request #${req.number}` : "Priced by opening, from the price book."}
      />

      <Panel className="mb-6">
        <SectionLabel>How pricing works</SectionLabel>
        <p className="text-sm leading-relaxed text-ink-dim">
          Each opening is priced on its own area at the series rate, plus its support posts and a deployment kit.
          Openings wider than 9 ft take a third, centre post. Plank count is the protection height divided by{" "}
          <span className="font-mono text-ink">{PANEL_HEIGHT_IN}&quot;</span> of effective coverage per plank, rounded up.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(Object.keys(SERIES_RATE_PER_SQFT_CENTS) as (keyof typeof SERIES_RATE_PER_SQFT_CENTS)[]).map((s) => (
            <div key={s} className="rounded-xl border border-line p-3">
              <p className="flex items-center justify-between text-sm font-semibold capitalize text-ink">
                {s}
                {s === "titanium" && <Badge tone="ember">Quote only</Badge>}
              </p>
              <p className="mt-1 font-mono text-lg tabular-nums text-teal">
                {money(SERIES_RATE_PER_SQFT_CENTS[s], true)}<span className="text-xs text-ink-faint">/sqft</span>
              </p>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div className="flex justify-between"><dt className="text-ink-dim">Support post</dt><dd className="font-mono tabular-nums text-ink">{money(POST_COST_EACH_CENTS)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-dim">Deployment kit</dt><dd className="font-mono tabular-nums text-ink">{money(DEPLOY_KIT_PER_OPENING_CENTS)}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-dim">Install labor</dt><dd className="font-mono tabular-nums text-ink">{money(INSTALL_PER_OPENING_CENTS)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-faint">
          Rates are the ones carried on the marketing site&apos;s estimator and are still marked provisional
          pending the owner&apos;s confirmed $/sqft.
        </p>
      </Panel>

      {openings.length > 0 ? (
        <Panel>
          <SectionLabel>Openings on file at {prop?.address}</SectionLabel>
          <Table>
            <thead>
              <tr>
                <Th>Opening</Th>
                <Th align="center">Size</Th>
                <Th align="center">Planks</Th>
                <Th align="right">Sentinel</Th>
                <Th align="right">Onyx</Th>
              </tr>
            </thead>
            <tbody>
              {openings.map((o) => (
                <tr key={o.id} className="text-ink-dim">
                  <Td>
                    <span className="text-sm text-ink">{o.label}</span>
                    <span className="block text-xs capitalize text-ink-faint">{o.type.replace(/_/g, " ")}</span>
                  </Td>
                  <Td align="center" className="font-mono text-xs tabular-nums">{o.widthIn}&quot; × {o.protectionHeightIn}&quot;</Td>
                  <Td align="center" className="font-mono text-xs tabular-nums">{panelCountFor(o.protectionHeightIn)}</Td>
                  <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(priceOpening(o.widthIn, o.protectionHeightIn, "sentinel", 1))}</Td>
                  <Td align="right" className="font-mono text-sm tabular-nums text-ink">{money(priceOpening(o.widthIn, o.protectionHeightIn, "onyx", 1))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-5 border-t border-line pt-5">
            <QuoteFromRequestForm requestId={req!.id} openingCount={openings.length} />
          </div>
        </Panel>
      ) : (
        <Panel>
          <SectionLabel>Start from a property</SectionLabel>
          <p className="text-sm text-ink-dim">
            Pick a client with measured openings, or add openings during the on-site assessment.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {db().clients.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className="block rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                  <span className="block text-sm font-semibold text-ink">{c.name}</span>
                  <span className="block text-xs text-ink-faint">{propertyFor(c.id)?.city}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
