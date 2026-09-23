import Link from "next/link";
import { Badge } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { OpsButton } from "@/components/Ops";
import type { AttemptCounts } from "@/lib/outbox";
import type { TextFlow } from "@/lib/text-automations";

export function consentPlain(marketing: boolean): { label: string; body: string } {
  return marketing
    ? {
        label: "Needs a yes to promotional texts",
        body: "Promotional means offers, storm alerts and anything not about a job they already have. It is a separate, stricter yes, and “Reply STOP to opt out.” is always added.",
      }
    : {
        label: "Needs a yes to project texts",
        body: "Project texts are about their own enquiry, visit, quote or invoice. They still have to have agreed to get texts from us.",
      };
}

export function OnOff({ flow }: { flow: TextFlow }) {
  if (flow.family === "built_in") return <Badge tone="good"><span className="h-1.5 w-1.5 rounded-full bg-current" />Always on</Badge>;
  if (!flow.wired) return <Badge tone="neutral">Not connected yet</Badge>;
  return (
    <Badge tone={flow.on ? "good" : "warn"}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {flow.on ? "On" : "Off"}
    </Badge>
  );
}

export function Toggle({ flow }: { flow: TextFlow }) {
  if (!flow.automation) return null;
  return (
    <OpsButton
      input={{ kind: "automation.toggle", id: flow.automation.id, armed: !flow.on }}
      variant={flow.on ? "outline" : "primary"}
      confirm={flow.on ? undefined : `Turn on ${flow.name}?`}
    >
      {flow.on ? "Turn off" : "Turn on"}
    </OpsButton>
  );
}

/** Everything that can stop this text, in the order the system checks. */
export function stopsFor(flow: TextFlow): string[] {
  const out = [
    "They replied STOP. Nothing goes to them again unless they text START.",
    flow.marketing ? "They haven't said yes to promotional texts." : "They haven't agreed to texts yet.",
  ];
  if (flow.family === "automation") {
    out.push("It's outside texting hours (8am to 9pm Eastern). The morning run is at about 9am, so this is rare.");
    out.push(flow.on ? "Someone turns it off. While off it still checks who is due, but sends nothing." : "It is turned off right now, so nothing is sent.");
    if (flow.automation) out.push(`The daily limit is reached: at most ${flow.automation.maxSendsPerRun} per morning run, so a backlog can never flood people.`);
    out.push("They already got this step. Each person gets each step once, even if the run repeats.");
    if (flow.emailFirst) out.push("We have their email address. This one emails first and only texts people with no email on file.");
  } else {
    out.push("It's outside texting hours (8am to 9pm Eastern). This one is skipped, not saved for later.");
  }
  out.push("Phone carrier registration isn't finished. Carriers block business texts from unregistered senders, so texts are held until it is.");
  return out;
}

export function RulesBox() {
  const rules: { icon: IconName; title: string; body: string }[] = [
    { icon: "check", title: "Only people who said yes", body: "A text only goes to someone who agreed to get texts from HydroDam. Promotional texts need their own, separate yes." },
    { icon: "x", title: "STOP always wins", body: "Anyone who replies STOP is never texted again, by any automation, until they text START." },
    { icon: "clock", title: "Texting hours are 8am to 9pm", body: "Eastern time. Florida's rules are stricter than the federal ones, so nothing goes out at night." },
    { icon: "shield", title: "Never the same text twice", body: "Each step of an automation reaches each person once. Running it again cannot send a repeat." },
    { icon: "phone", title: "Carrier registration", body: "Phone companies make businesses register before they text customers (it is called 10DLC). Until HydroDam's registration is done, texts are held, not sent." },
    { icon: "refresh", title: "Turning one on never catches up", body: "It only counts customers from the moment it is switched on, so it can never text a backlog of old leads." },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rules.map((r) => (
        <li key={r.title} className="rounded-xl border border-line/70 bg-white/[0.02] p-3 text-center">
          <span className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-teal/10 text-teal">
            <Icon name={r.icon} size={14} />
          </span>
          <p className="text-sm font-semibold text-ink">{r.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function FlowCard({ flow, counts, sent }: { flow: TextFlow; counts?: AttemptCounts; sent?: number }) {
  const consent = consentPlain(flow.marketing);
  return (
    <div className="panel flex flex-col rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/automations/${flow.key}`} className="font-display text-base font-semibold text-ink hover:text-teal">
          {flow.name}
        </Link>
        <OnOff flow={flow} />
      </div>
      <p className="mt-1.5 text-sm text-ink-dim">{flow.what}</p>

      <dl className="mt-3 grid gap-2 text-xs">
        <div><dt className="inline font-semibold text-ink">When: </dt><dd className="inline text-ink-dim">{flow.when}</dd></div>
        <div><dt className="inline font-semibold text-ink">Who: </dt><dd className="inline text-ink-dim">{flow.who}</dd></div>
        <div><dt className="inline font-semibold text-ink">Permission: </dt><dd className="inline text-ink-dim">{consent.label}</dd></div>
        {flow.emailFirst && <div className="text-ink-faint">Emails first when we have their email address.</div>}
      </dl>

      <div className="mt-3 rounded-xl bg-teal/[0.07] px-3 py-2 ring-1 ring-line/70">
        <p className="text-xs leading-relaxed text-ink">{flow.current || "None"}</p>
        {flow.override && <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-teal">Your wording</p>}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          {counts
            ? `7 days: ${counts.sent} sent · ${counts.suppressed} not sent · ${counts.failed} failed`
            : sent !== undefined
              ? `7 days: ${sent} sent`
              : "7 days: none"}
        </span>
        <span className="flex gap-2">
          <Toggle flow={flow} />
          <Link href={`/automations/${flow.key}`} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-teal ring-1 ring-line-bright hover:bg-teal/10">
            Edit and track <Icon name="external" size={12} />
          </Link>
        </span>
      </div>
    </div>
  );
}
