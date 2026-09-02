import { Badge } from "@/components/ui";
import type { ChecklistSpec } from "@/lib/builder";

export function ChecklistCard({ name, spec, compact = false }: { name: string; spec: ChecklistSpec; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-line/60 p-3">
      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
        {name}
        <Badge tone={spec.audience === "crew" ? "teal" : "neutral"}>{spec.audience}</Badge>
      </p>
      {spec.intro && !compact && <p className="mt-1 text-xs leading-relaxed text-ink-dim">{spec.intro}</p>}
      <ol className="mt-2 flex flex-col gap-1.5">
        {spec.steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line font-mono text-[9px] text-ink-faint">{i + 1}</span>
            <span className="text-ink">
              {s.label}{s.required && <span className="text-ember"> *</span>}
              {s.help && !compact && <span className="block text-ink-faint">{s.help}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
