import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-dim">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rounded-2xl p-5 ${className}`}>{children}</div>;
}

export function StatCard({ label, value, sub, accent = "teal" }: { label: string; value: ReactNode; sub?: string; accent?: "teal" | "ember" | "good" }) {
  const color = accent === "ember" ? "text-ember" : accent === "good" ? "text-good" : "text-teal";
  return (
    <div className="panel rounded-2xl p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold sm:text-3xl ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-dim">{sub}</p>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "teal" }) {
  const map = {
    neutral: "border-line bg-white/5 text-ink-dim",
    good: "border-good/40 bg-good/10 text-good",
    warn: "border-warn/40 bg-warn/10 text-warn",
    bad: "border-bad/40 bg-bad/10 text-bad",
    teal: "border-line-bright bg-teal/10 text-teal",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${map}`}>{children}</span>;
}

export function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <Badge tone={connected ? "good" : "warn"}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {connected ? "HubSpot live" : "Demo data"}
    </Badge>
  );
}
