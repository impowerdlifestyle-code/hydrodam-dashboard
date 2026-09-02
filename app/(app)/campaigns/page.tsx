import { Badge, PageHeader, Panel, SectionLabel, StatCard, Table, Td, Th } from "@/components/ui";
import { CampaignComposer } from "@/components/CampaignComposer";
import { AUDIENCES, MAX_PER_SEND, audienceCounts, inQuietHours, listCampaigns, sendBlocker, type Audience } from "@/lib/campaigns";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns · HydroDam Ops" };

export default async function CampaignsPage() {
  const [counts, past] = await Promise.all([audienceCounts(), listCampaigns()]);
  const blocked = sendBlocker();
  const sent30 = past
    .filter((c) => Date.now() - Date.parse(c.started_at) < 30 * 86_400_000)
    .reduce((s, c) => s + c.sent, 0);
  const audiences = (Object.keys(AUDIENCES) as Audience[]).map((key) => ({ key, label: AUDIENCES[key], count: counts[key] }));

  return (
    <>
      <PageHeader title="Campaigns" subtitle="One text, written by you, to everyone who said yes to hearing from HydroDam." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Can be texted" value={counts.all} sub="opted in to marketing, no STOP on file" accent="teal" />
        <StatCard label="Sent, 30 days" value={sent30} sub="from campaigns" />
        <StatCard label="Carrier" value={blocked ? "Held" : "Live"} sub={blocked ? "see the notice below" : `up to ${MAX_PER_SEND} per send`} accent={blocked ? "warn" : "good"} />
      </div>

      <Panel className="my-6">
        <SectionLabel>New campaign</SectionLabel>
        <CampaignComposer audiences={audiences} blocked={blocked} quiet={inQuietHours()} />
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Preview shows exactly who gets it and the merged text for the first person. Every recipient must have ticked the
          SMS box on the website or been recorded as consenting, anyone who texted STOP is excluded automatically, and each
          send is logged per person so nobody is texted twice by the same campaign. Replies land in the Inbox.
        </p>
      </Panel>

      <Panel>
        <SectionLabel>Sent campaigns</SectionLabel>
        {past.length === 0 ? (
          <p className="text-sm text-ink-dim">Nothing sent yet.</p>
        ) : (
          <Table compact>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Audience</Th>
                <Th>Message</Th>
                <Th align="center">Sent</Th>
                <Th align="center">Failed</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {past.map((c) => (
                <tr key={c.id}>
                  <Td>{c.planned.name ?? "Untitled"}</Td>
                  <Td><Badge tone="teal">{c.planned.audience ? AUDIENCES[c.planned.audience] : "?"}</Badge></Td>
                  <Td className="max-w-sm truncate text-ink-dim">{c.planned.text}</Td>
                  <Td align="center">{c.sent}</Td>
                  <Td align="center">{c.errors ? <span className="text-bad">{c.errors}</span> : 0}</Td>
                  <Td className="text-ink-faint">{shortDate(c.started_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
