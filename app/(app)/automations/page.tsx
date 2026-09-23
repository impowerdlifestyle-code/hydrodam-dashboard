import Link from "next/link";
import { Badge, PageHeader, Panel, SectionLabel, SeedNotice, StatCard } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AttemptsTable, FilterPills, Pager } from "@/components/Outbox";
import { FlowCard, RulesBox } from "@/components/TextFlows";
import { DB_LIVE, db, ensureData } from "@/lib/db";
import { attemptCounts7d, automationAttempts, automationName, builtInSent7d } from "@/lib/outbox";
import { textFlows } from "@/lib/text-automations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automations · HydroDam Ops" };

const PAGE_SIZE = 25;

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; op?: string }>;
}) {
  await ensureData();
  const { a, op = "1" } = await searchParams;
  const page = Math.max(1, Number(op) || 1);

  const [flows, counts, builtInSent, attempts] = await Promise.all([
    textFlows(),
    attemptCounts7d(),
    builtInSent7d(),
    automationAttempts({ key: a, page, pageSize: PAGE_SIZE }),
  ]);

  const engine = flows.filter((f) => f.family === "automation");
  const builtIns = flows.filter((f) => f.family === "built_in");
  const emailOnly = db().automations.filter((x) => !x.channels.includes("sms"));
  const totals = Object.values(counts).reduce(
    (t, c) => ({ sent: t.sent + c.sent, held: t.held + c.suppressed + c.failed }),
    { sent: 0, held: 0 }
  );
  const filterKeys = [...new Set([...engine.map((f) => f.key), "campaign", ...Object.keys(counts)])];
  const href = (next: { a?: string; op?: number }) => {
    const q = new URLSearchParams();
    const key = "a" in next ? next.a : a;
    if (key) q.set("a", key);
    if (next.op && next.op > 1) q.set("op", String(next.op));
    const s = q.toString();
    return `/automations${s ? `?${s}` : ""}#recent`;
  };

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="Texts the system sends on its own: what each one says, when it goes out, and what it actually did."
      />

      <SeedNotice what="The automations, sends and changes on this page are sample rows." live={DB_LIVE} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Text automations on" value={`${engine.filter((f) => f.on).length}/${engine.length}`} sub="plus two texts that are always on" accent="good" />
        <StatCard label="Sent, last 7 days" value={totals.sent} sub="by automations and campaigns" accent="teal" href={href({})} />
        <StatCard label="Not sent, last 7 days" value={totals.held} sub="a rule stopped them; see why below" accent={totals.held ? "warn" : "good"} href={href({})} />
      </div>

      <Panel className="my-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-lg font-semibold text-ink">How your text automations work</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">
            Every morning at about 9am the system looks for customers who are due a text: a visit tomorrow, a quote
            nobody has answered, an invoice coming due. For each one it checks the rules below, and only then sends.
            Two texts don&apos;t wait for the morning: the reply to a website enquiry and the booking confirmation go out
            the moment the customer acts. Open any automation to change its wording or timing, turn it on or off, and
            see exactly who got it and who didn&apos;t.
          </p>
        </div>
        <div className="mt-5">
          <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-widest text-ink-faint">The rules every text follows</p>
          <RulesBox />
        </div>
      </Panel>

      <section>
        <h2 className="mb-3 text-center font-mono text-[11px] uppercase tracking-wider text-ink-faint">Sent the moment a customer acts</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {builtIns.map((f) => <FlowCard key={f.key} flow={f} sent={builtInSent[f.key]} />)}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-center font-mono text-[11px] uppercase tracking-wider text-ink-faint">Checked every morning</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {engine.map((f) => <FlowCard key={f.key} flow={f} counts={counts[f.key] ?? { sent: 0, suppressed: 0, failed: 0 }} />)}
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        <Panel>
          <SectionLabel action={<Link href="/campaigns" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
            Campaigns
          </SectionLabel>
          <p className="text-sm text-ink-dim">
            A one-off text you write and send to a list, like a storm warning. Only people who said yes to promotional
            texts get it, and &ldquo;Reply STOP to opt out.&rdquo; is added for you.
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            7 days: {counts.campaign?.sent ?? 0} sent · {(counts.campaign?.suppressed ?? 0) + (counts.campaign?.failed ?? 0)} not sent
          </p>
        </Panel>
        <Panel>
          <SectionLabel action={<Link href="/texts" className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">Open</Link>}>
            Texts copilot
          </SectionLabel>
          <p className="text-sm text-ink-dim">
            For one customer at a time: the copilot drafts, you edit, and nothing goes until you press Send. Every text
            sent is listed under Texts, Sent.
          </p>
        </Panel>
        <Panel>
          <SectionLabel>Email only</SectionLabel>
          {emailOnly.length === 0 ? <p className="text-sm text-ink-dim">None</p> : (
            <ul className="flex flex-col gap-2">
              {emailOnly.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink">{x.name.replace(/\s*[—–]\s*/g, ", ")}</span>
                  <Badge tone={x.armed ? "good" : "warn"}>{x.armed ? "On" : "Off"}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-faint">These never text anyone.</p>
        </Panel>
      </section>

      <Panel className="mt-8">
        <div id="recent" className="scroll-mt-6" />
        <SectionLabel>Recent sends, and the ones that didn&apos;t go</SectionLabel>
        <p className="mb-4 text-xs text-ink-dim">
          Every text an automation or campaign tried to send. When a rule stopped one, the reason is in plain words on the right.
        </p>
        <FilterPills
          label="Automation"
          options={[
            { href: href({ a: undefined }), label: "All", active: !a },
            ...filterKeys.map((k) => ({ href: href({ a: k }), label: automationName(k), active: a === k })),
          ]}
        />
        <div className="mt-4">
          <AttemptsTable rows={attempts.rows} empty={a ? `Nothing from ${automationName(a)} yet` : "No automation has tried to send a text yet"} />
        </div>
        <Pager page={page} pages={Math.max(1, Math.ceil(attempts.total / PAGE_SIZE))} total={attempts.total} pageSize={PAGE_SIZE} href={(p) => href({ op: p })} />
      </Panel>

      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-faint">
        <Icon name="shield" size={13} />
        Changes to wording, timing and on or off are recorded with who made them, on each automation&apos;s page.
      </p>
      {engine.filter((f) => !f.wired).length > 0 && (
        <p className="mt-2 text-center text-xs text-ink-faint">
          &ldquo;Not connected yet&rdquo; means nothing in the app sends that text today, whether it is on or off.
        </p>
      )}
    </>
  );
}
