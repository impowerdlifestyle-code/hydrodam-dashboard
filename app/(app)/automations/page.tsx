import { Badge, PageHeader, Panel, SectionLabel, StatCard, Table, Td, Th } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { OpsButton } from "@/components/Ops";
import { db, ensureData } from "@/lib/db";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automations · HydroDam Ops" };

const OFFSET_LABEL = (days: number[]) =>
  days.map((d) => (d === 0 ? "same day" : d < 0 ? `${-d}d before` : `+${d}d`)).join(", ");

export default async function AutomationsPage() {
  await ensureData();
  const d = db();
  const armed = d.automations.filter((a) => a.armed);
  const disarmed = d.automations.filter((a) => !a.armed);
  const sent30 = d.automations.reduce((s, a) => s + a.sentLast30d, 0);

  return (
    <>
      <PageHeader title="Automations" subtitle="Every message the system sends on its own, and the gates that stop it." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Armed" value={`${armed.length}/${d.automations.length}`} accent="good" />
        <StatCard label="Sent, 30 days" value={sent30} sub="across all channels" />
        <StatCard label="Held back" value={disarmed.length} sub="dry run only" accent={disarmed.length ? "warn" : "good"} />
      </div>

      <Panel className="my-6 border-ember/30">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember/15 text-ember">
            <Icon name="shield" size={16} />
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-ink">Four gates stand between an automation and a send</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">
              The CRM carries thousands of dormant contacts, so a naive &ldquo;everyone with status X&rdquo; rule would
              mail a four-figure list on its first run and burn the sending domain. Every send has to clear all four:
              an <strong className="text-ink">epoch</strong> so nothing older than the go-live date is ever eligible;
              <strong className="text-ink"> exact-day matching</strong>, because past due is not the same as due;
              a <strong className="text-ink">dedupe record</strong> per step and occurrence; and the
              <strong className="text-ink"> armed flag</strong>, which when unset produces a dry run that logs exactly
              who would have been mailed. A per-run cap sits on top.
            </p>
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionLabel>Rules</SectionLabel>
        <Table>
          <thead>
            <tr>
              <Th>Automation</Th>
              <Th>Trigger</Th>
              <Th>Schedule</Th>
              <Th>Channels</Th>
              <Th>Consent</Th>
              <Th align="center">Cap</Th>
              <Th align="right">Sent 30d</Th>
              <Th>State</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {d.automations.map((a) => (
              <tr key={a.id} className="text-ink-dim">
                <Td>
                  <span className="text-sm font-semibold text-ink">{a.name}</span>
                  {a.epochAt && <span className="block font-mono text-[10px] text-ink-faint">epoch {shortDate(a.epochAt)}</span>}
                </Td>
                <Td className="font-mono text-[11px]">{a.trigger}</Td>
                <Td className="text-xs">{OFFSET_LABEL(a.offsetsDays)}</Td>
                <Td>
                  <span className="flex gap-1">
                    {a.channels.map((c) => <Badge key={c} tone={c === "sms" ? "teal" : "neutral"}>{c}</Badge>)}
                  </span>
                </Td>
                <Td className="text-xs">
                  {a.requiresConsent ? <span className="text-warn">{a.requiresConsent.replace(/_/g, " ")}</span> : <span className="text-ink-faint">transactional</span>}
                </Td>
                <Td align="center" className="font-mono text-xs tabular-nums">{a.maxSendsPerRun}</Td>
                <Td align="right" className="font-mono text-xs tabular-nums text-ink">{a.sentLast30d}</Td>
                <Td>
                  <Badge tone={a.armed ? "good" : "warn"}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {a.armed ? "Armed" : "Dry run"}
                  </Badge>
                </Td>
                <Td align="right">
                  <OpsButton
                    input={{ kind: "automation.toggle", id: a.id, armed: !a.armed }}
                    variant={a.armed ? "outline" : "primary"}
                    confirm={a.armed ? undefined : `Arm ${a.name}?`}
                  >
                    {a.armed ? "Disarm" : "Arm"}
                  </OpsButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Held back, and why</SectionLabel>
          <ul className="flex flex-col gap-2">
            {disarmed.map((a) => (
              <li key={a.id} className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-sm font-semibold text-ink">{a.name}</p>
                <p className="mt-1 text-xs text-ink-dim">
                  {!a.epochAt
                    ? "No epoch set, so nothing is eligible. Arming without one is refused."
                    : "Armed flag off — runs produce a plan, not a send."}
                </p>
              </li>
            ))}
            {disarmed.length === 0 && <p className="text-sm text-ink-dim">Everything is live.</p>}
          </ul>
        </Panel>

        <Panel>
          <SectionLabel>Compliance</SectionLabel>
          <ul className="flex flex-col gap-3 text-xs leading-relaxed text-ink-dim">
            <li className="flex gap-2">
              <span className="mt-0.5 text-teal"><Icon name="check" size={13} /></span>
              <span>The verbatim opt-in wording is stored per client, with the timestamp and where it was given. That text is the evidence, so it is never paraphrased.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-teal"><Icon name="check" size={13} /></span>
              <span>Marketing SMS checks consent before every send. Transactional messages about a booked job are exempt.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-teal"><Icon name="check" size={13} /></span>
              <span>Quiet hours 8am–9pm Eastern. Florida&apos;s mini-TCPA is stricter than the federal rule.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-0.5 text-teal"><Icon name="check" size={13} /></span>
              <span>STOP and HELP are handled on inbound and write a revocation the automations read.</span>
            </li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
