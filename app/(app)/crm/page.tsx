import { getCrmSummary, fmtUSD } from "@/lib/hubspot";
import { PageHeader, Panel, Badge, ConnectionPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const crm = await getCrmSummary();
  return (
    <>
      <PageHeader title="CRM" subtitle="Deals and contacts from HubSpot." action={<ConnectionPill connected={crm.connected} />} />

      <Panel>
        <h2 className="font-display text-lg font-bold text-ink">Deals</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                <th className="py-2 pr-4 font-medium">Deal</th>
                <th className="py-2 pr-4 font-medium">Stage</th>
                <th className="py-2 pr-4 font-medium">Close</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {crm.deals.map((d) => (
                <tr key={d.id}>
                  <td className="py-3 pr-4 font-medium text-ink">{d.name}</td>
                  <td className="py-3 pr-4"><Badge tone={/won/i.test(d.stage) ? "good" : /lost/i.test(d.stage) ? "bad" : "teal"}>{d.stage}</Badge></td>
                  <td className="py-3 pr-4 text-ink-dim">{d.closeDate ?? "—"}</td>
                  <td className="py-3 text-right font-mono text-ink">{fmtUSD(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mt-6">
        <h2 className="font-display text-lg font-bold text-ink">Contacts</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {crm.contacts.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-abyss/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-ink">{c.name}</p>
                {c.stage && <Badge tone="teal">{c.stage}</Badge>}
              </div>
              <p className="mt-1.5 text-xs text-ink-dim">{c.email}</p>
              {c.phone && <p className="text-xs text-ink-faint">{c.phone}</p>}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
