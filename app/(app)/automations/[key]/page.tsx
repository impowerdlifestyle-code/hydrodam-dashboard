import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, SectionLabel, StatCard } from "@/components/ui";
import { AttemptsTable, Pager, SentTable } from "@/components/Outbox";
import { TimingEditor, WordingEditor } from "@/components/AutomationEditor";
import { OnOff, Toggle, consentPlain, stopsFor } from "@/components/TextFlows";
import { ensureData } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { attemptCounts7d, automationAttempts, outboundTexts } from "@/lib/outbox";
import { history, textFlow } from "@/lib/text-automations";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function AutomationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ op?: string }>;
}) {
  await ensureData();
  const { key } = await params;
  const page = Math.max(1, Number((await searchParams).op) || 1);
  const flow = await textFlow(key);
  if (!flow) notFound();

  const consent = consentPlain(flow.marketing);
  const [counts, attempts, sent, changes] = await Promise.all([
    attemptCounts7d(),
    flow.family === "automation" ? automationAttempts({ key, page, pageSize: PAGE_SIZE }) : undefined,
    flow.family === "built_in"
      ? outboundTexts({ source: key === "lead_ack" ? "lead_ack" : "booking", range: "30d", page, pageSize: PAGE_SIZE })
      : undefined,
    history(key),
  ]);
  const c = counts[key] ?? { sent: 0, suppressed: 0, failed: 0 };
  const total = attempts?.total ?? sent?.total ?? 0;
  const pageHref = (p: number) => `/automations/${key}${p > 1 ? `?op=${p}` : ""}#recent`;

  return (
    <>
      <Link href="/automations" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
        ← Automations
      </Link>

      <PageHeader
        title={flow.name}
        subtitle={flow.what}
        action={<div className="flex items-center gap-2"><OnOff flow={flow} /><Toggle flow={flow} /></div>}
      />

      {flow.family === "automation" && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Sent, 7 days" value={c.sent} accent="good" />
          <StatCard label="Not sent, 7 days" value={c.suppressed} sub="a rule stopped them" accent={c.suppressed ? "warn" : "good"} />
          <StatCard label="Failed, 7 days" value={c.failed} sub="the phone company refused" accent={c.failed ? "bad" : "good"} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>How it works</SectionLabel>
          <dl className="flex flex-col gap-3 text-sm">
            <div><dt className="font-semibold text-ink">Who gets it</dt><dd className="text-ink-dim">{flow.who}</dd></div>
            <div><dt className="font-semibold text-ink">When it goes out</dt><dd className="text-ink-dim">{flow.when} Never before 8am or after 9pm Eastern.</dd></div>
            <div><dt className="font-semibold text-ink">{consent.label}</dt><dd className="text-ink-dim">{consent.body}</dd></div>
            {flow.emailFirst && (
              <div><dt className="font-semibold text-ink">Email or text</dt><dd className="text-ink-dim">If we have their email address this one sends an email instead. Only people without one get the text.</dd></div>
            )}
            <div>
              <dt className="font-semibold text-ink">Right now</dt>
              <dd className="text-ink-dim">
                {flow.family === "built_in"
                  ? "Always on while texting is connected."
                  : !flow.wired
                    ? "Nothing in the app sends this text yet, so it does nothing whether it is on or off."
                    : flow.on ? "On. It sends to whoever is due each morning." : "Off. It checks who is due each morning but sends nothing."}
              </dd>
            </div>
          </dl>

          <p className="mb-2 mt-5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">What stops it</p>
          <ul className="flex flex-col gap-1.5 text-xs text-ink-dim">
            {stopsFor(flow).map((s) => <li key={s} className="flex gap-2"><span className="text-warn">•</span>{s}</li>)}
          </ul>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionLabel>{flow.override ? "Sending now: your wording" : "Sending now: the built-in wording"}</SectionLabel>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-teal/15 px-3.5 py-2.5 ring-1 ring-line-bright">
                <p className="text-sm leading-relaxed text-ink">{flow.current || "None"}</p>
              </div>
            </div>
            <p className="mt-1.5 text-right text-[11px] text-ink-faint">
              Shown for a sample customer.{flow.override?.by ? ` Last changed by ${flow.override.by}, ${dateTime(flow.override.at)}.` : ""}
            </p>
          </Panel>

          <Panel>
            <SectionLabel>Change the wording</SectionLabel>
            <WordingEditor flowKey={flow.key} initial={flow.starter} tokens={flow.tokens} marketing={flow.marketing} customised={Boolean(flow.override)} />
            {key === "lead_ack" && (
              <p className="mt-3 text-xs text-ink-faint">
                The morning &ldquo;Speed to lead&rdquo; automation has its own wording, so change that one separately if you want them to match.
              </p>
            )}
          </Panel>

          {flow.automation && flow.anchor && flow.wired && (
            <Panel>
              <SectionLabel>When it goes out</SectionLabel>
              <TimingEditor flowKey={flow.key} offsets={flow.automation.offsetsDays} anchor={flow.anchor} before={flow.before} after={flow.after} />
            </Panel>
          )}
        </div>
      </div>

      <Panel className="mt-6">
        <div id="recent" className="scroll-mt-6" />
        <SectionLabel>{flow.family === "automation" ? "Recent sends, and the ones that didn't go" : "Sent in the last 30 days"}</SectionLabel>
        {attempts && <AttemptsTable rows={attempts.rows} empty="Nothing tried yet" />}
        {sent && (
          <>
            <p className="mb-3 text-xs text-ink-dim">This text isn&apos;t logged when a rule stops it, so only the ones that went are listed.</p>
            <SentTable rows={sent.rows} empty="None sent yet" />
          </>
        )}
        <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} href={pageHref} />
      </Panel>

      <Panel className="mt-6">
        <SectionLabel>Change history</SectionLabel>
        {changes.length === 0 ? (
          <p className="text-sm text-ink-dim">None yet. Changes to wording, timing and on or off are listed here with who made them.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {changes.map((h, i) => (
              <li key={i} className="rounded-xl border border-line/70 p-3">
                <p className="text-sm text-ink">{h.summary}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{h.by} · {dateTime(h.at)}</p>
                {typeof h.changes.before === "string" && typeof h.changes.after === "string" && (
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <p className="rounded-lg bg-white/[0.03] p-2 text-ink-faint"><span className="font-semibold text-ink-dim">Before: </span>{h.changes.before}</p>
                    <p className="rounded-lg bg-teal/[0.07] p-2 text-ink-dim"><span className="font-semibold text-ink">After: </span>{h.changes.after}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
