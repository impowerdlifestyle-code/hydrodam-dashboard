import { PageHeader, Panel, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SOPS } from "@/lib/data";

export default function SopsPage() {
  return (
    <>
      <PageHeader title="SOPs" subtitle="The HydroDam playbook — how the team runs every job." />
      <div className="space-y-4">
        {SOPS.map((s) => (
          <Panel key={s.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-ink">{s.title}</h2>
              <div className="flex items-center gap-2">
                <Badge tone="teal">{s.category}</Badge>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Updated {s.updated}</span>
              </div>
            </div>
            <ol className="mt-4 space-y-2.5">
              {s.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-ink-dim">
                  <Icon name="check" size={16} className="mt-0.5 shrink-0 text-teal" />
                  {step}
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
    </>
  );
}
