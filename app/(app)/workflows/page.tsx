import { PageHeader, Panel, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { WORKFLOWS } from "@/lib/data";

const tone = { live: "good", draft: "warn", paused: "neutral" } as const;

export default function WorkflowsPage() {
  return (
    <>
      <PageHeader title="Workflows" subtitle="Automations that run the sales engine." />
      <div className="grid gap-4 lg:grid-cols-2">
        {WORKFLOWS.map((w) => (
          <Panel key={w.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-ink">{w.name}</h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Trigger · {w.trigger}</p>
              </div>
              <Badge tone={tone[w.status]}><span className="h-1.5 w-1.5 rounded-full bg-current" />{w.status}</Badge>
            </div>
            <ol className="mt-4 space-y-2">
              {w.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-ink-dim">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal/15 font-mono text-[10px] text-teal">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
      <p className="mt-5 flex items-center gap-2 text-xs text-ink-faint">
        <Icon name="flow" size={14} /> Workflow status mirrors your automation platform — wire live status via the HubSpot / automation API.
      </p>
    </>
  );
}
