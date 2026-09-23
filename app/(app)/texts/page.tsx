import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, RowLink, SeedNotice, StatCard, StatusPill, Table, Td, Th } from "@/components/ui";
import { DB_LIVE, ensureData } from "@/lib/db";
import { phoneDisplay, relative } from "@/lib/format";
import { textRoster, type ConsentState } from "@/lib/sms-copilot";
import { telnyxStatus } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
// First render of a cold instance pages ~3,000 HubSpot contacts.
export const maxDuration = 60;
export const metadata = { title: "Texts · HydroDam Ops" };

const PAGE_SIZE = 100;

const CONSENT: Record<ConsentState, { label: string; tone: "good" | "teal" | "bad" | "neutral" }> = {
  marketing: { label: "Marketing", tone: "good" },
  transactional: { label: "Transactional", tone: "teal" },
  stop: { label: "STOP", tone: "bad" },
  none: { label: "None", tone: "neutral" },
};

export default async function TextsPage({
  searchParams,
}: {
  searchParams: Promise<{ needs?: string; q?: string; p?: string }>;
}) {
  await ensureData();
  const { needs, q = "", p = "1" } = await searchParams;
  const onlyNeeds = needs === "1";
  const telnyx = telnyxStatus();

  const roster = textRoster();
  const needing = roster.filter((r) => r.needs.length > 0);
  const needle = q.trim().toLowerCase();
  const matched = (onlyNeeds ? needing : roster)
    .filter((r) => (needle ? `${r.client.name} ${r.client.phone ?? ""}`.toLowerCase().includes(needle) : true))
    .sort((a, b) =>
      b.needs.length - a.needs.length ||
      (b.last?.createdAt ?? b.client.createdAt).localeCompare(a.last?.createdAt ?? a.client.createdAt)
    );

  const page = Math.max(1, Number(p) || 1);
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const rows = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (next: Record<string, string>) =>
    `/texts?${new URLSearchParams({ ...(onlyNeeds ? { needs: "1" } : {}), ...(q ? { q } : {}), ...next }).toString()}`;
  const textable = roster.filter((r) => r.consent === "transactional" || r.consent === "marketing").length;

  return (
    <>
      <PageHeader
        title="Texts"
        subtitle="Everyone with a mobile number. Draft with the copilot, send with a click."
        action={
          <Badge tone={telnyx.live ? "good" : "warn"}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {telnyx.live ? `Telnyx ${phoneDisplay(telnyx.from)}` : "Telnyx not connected"}
          </Badge>
        }
      />

      <SeedNotice what="Clients, threads and drafts on this page are sample rows." live={DB_LIVE} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="With a mobile" value={roster.length.toLocaleString()} />
        <StatCard label="Needs a text" value={needing.length.toLocaleString()} accent={needing.length ? "ember" : "good"} href="/texts?needs=1" />
        <StatCard label="Can be texted" value={textable.toLocaleString()} sub="transactional consent on file, no STOP" accent="teal" />
      </div>

      <nav className="my-6 flex flex-wrap items-center gap-2">
        {[
          { key: "all", label: "Everyone", href: q ? `/texts?q=${encodeURIComponent(q)}` : "/texts" },
          { key: "needs", label: `Needs a text (${needing.length})`, href: `/texts?${new URLSearchParams({ needs: "1", ...(q ? { q } : {}) })}` },
        ].map((x) => (
          <Link
            key={x.key}
            href={x.href}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              (x.key === "needs") === onlyNeeds ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
        <form action="/texts" className="ml-auto flex items-center gap-2">
          {onlyNeeds && <input type="hidden" name="needs" value="1" />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or phone…"
            className="w-56 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-bright focus:outline-none"
          />
        </form>
      </nav>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            icon="phone"
            title={onlyNeeds ? "Nobody needs a text right now" : "No clients with a mobile number"}
            body={onlyNeeds ? "Quotes waiting over three days, tomorrow's visits, recent installs and unanswered texts land here." : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th align="center">Stage</Th>
                <Th align="center">Consent</Th>
                <Th>Last message</Th>
                <Th align="center">Needs</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ client: c, stage, stageStatus, consent, last, needs: why }) => (
                <tr key={c.id} className="text-ink-dim transition-colors hover:bg-white/[0.03]">
                  <Td>
                    <RowLink href={`/texts/${c.id}`}>
                      <span className="block text-sm font-semibold">{c.name}</span>
                      <span className="block text-xs text-ink-faint">{phoneDisplay(c.phone)}</span>
                    </RowLink>
                  </Td>
                  <Td align="center">
                    <span className="block text-xs text-ink-dim">{stage}</span>
                    {stageStatus && <StatusPill status={stageStatus} />}
                  </Td>
                  <Td align="center"><Badge tone={CONSENT[consent].tone}>{CONSENT[consent].label}</Badge></Td>
                  <Td className="max-w-[260px] pl-4">
                    {last ? (
                      <>
                        <span className="block truncate text-xs text-ink-dim">
                          {last.direction === "outbound" ? <span className="text-teal">You: </span> : <span className="text-ember">Them: </span>}
                          {last.body}
                        </span>
                        <span className="font-mono text-[10px] text-ink-faint">{relative(last.createdAt)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-ink-faint">No texts yet</span>
                    )}
                  </Td>
                  <Td align="center">
                    <span className="flex flex-col items-center gap-1">
                      {why.length ? why.map((n) => <Badge key={n.kind} tone="ember">{n.reason}</Badge>) : <span className="text-xs text-ink-faint">None</span>}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-xs text-ink-faint">
          <span className="font-mono">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()} to {Math.min(page * PAGE_SIZE, matched.length).toLocaleString()} of{" "}
            {matched.length.toLocaleString()}
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
