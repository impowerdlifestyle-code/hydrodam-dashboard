import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { initials, money, titleCase } from "@/lib/format";

/* ------------------------------------------------------------------ layout */

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

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{children}</p>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, accent = "teal", href }: { label: string; value: ReactNode; sub?: string; accent?: "teal" | "ember" | "good" | "warn" | "bad"; href?: string }) {
  const color = {
    teal: "text-teal", ember: "text-ember", good: "text-good", warn: "text-warn", bad: "text-bad",
  }[accent];
  const body = (
    <>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold sm:text-3xl ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-dim">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="panel block rounded-2xl p-5 transition-colors hover:border-line-bright">
        {body}
      </Link>
    );
  }
  return <div className="panel rounded-2xl p-5">{body}</div>;
}

/* ------------------------------------------------------------------ badges */

type Tone = "neutral" | "good" | "warn" | "bad" | "teal" | "ember";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-white/5 text-ink-dim",
  good: "border-good/40 bg-good/10 text-good",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  teal: "border-line-bright bg-teal/10 text-teal",
  ember: "border-ember/40 bg-ember/10 text-ember",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <Badge tone={connected ? "good" : "warn"}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {connected ? "Supabase live" : "Seed data"}
    </Badge>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // requests
  new: "ember", contacted: "teal", assessment_scheduled: "teal", assessed: "teal",
  converted: "good", unqualified: "neutral",
  // quotes
  draft: "neutral", sent: "teal", viewed: "warn", approved: "good", declined: "bad", expired: "neutral",
  // jobs
  pending: "neutral", scheduled: "teal", in_progress: "warn", on_hold: "bad",
  completed: "good", invoiced: "teal", closed: "neutral",
  // visits
  unscheduled: "ember", confirmed: "teal", en_route: "warn", no_show: "bad", cancelled: "neutral",
  // invoices
  partially_paid: "warn", paid: "good", void: "neutral",
  // payments
  processing: "warn", succeeded: "good", failed: "bad",
  // fabrication
  not_started: "neutral", cut_sheet_ready: "teal", in_fabrication: "warn",
  qc_passed: "good", ready_for_install: "good",
};

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{titleCase(status)}</Badge>;
}

export function Avatar({ name, size = 28, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold text-ink ring-1 ring-line-bright"
      style={{ width: size, height: size, background: color ? `${color}33` : "rgba(31,138,179,0.18)" }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, colors = [] }: { names: string[]; colors?: string[] }) {
  if (!names.length) return <span className="font-mono text-[10px] uppercase tracking-wider text-ember">Unassigned</span>;
  return (
    <span className="flex -space-x-1.5">
      {names.map((n, i) => (
        <Avatar key={n + i} name={n} size={24} color={colors[i]} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "ember";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-teal text-white hover:opacity-90",
  secondary: "bg-teal/15 text-teal ring-1 ring-line-bright hover:bg-teal/25",
  ghost: "text-ink-dim hover:bg-white/5 hover:text-ink",
  outline: "border border-line text-ink-dim hover:border-line-bright hover:text-teal",
  danger: "bg-bad text-white hover:opacity-90",
  ember: "bg-ember text-white hover:opacity-90",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", full = false) {
  return `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-opacity disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${full ? "w-full" : ""}`;
}

export function LinkButton({
  href, children, variant = "primary", size = "md", full = false, icon,
}: {
  href: string; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; full?: boolean; icon?: IconName;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, full)}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ tables */

/** `compact` drops the min-width so a table can live inside a narrow sidebar panel. */
export function Table({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className={`w-full border-collapse text-sm ${compact ? "" : "min-w-[560px]"}`}>{children}</table>
    </div>
  );
}

export function Th({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return (
    <th className={`border-b border-line pb-2.5 text-${align} font-mono text-[10px] font-normal uppercase tracking-widest text-ink-faint ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string }) {
  return <td className={`border-b border-line/60 py-3 text-${align} ${className}`}>{children}</td>;
}

export function Tr({ children, href }: { children: ReactNode; href?: string }) {
  if (!href) return <tr className="text-ink-dim">{children}</tr>;
  return <tr className="group cursor-pointer text-ink-dim transition-colors hover:bg-white/[0.03]">{children}</tr>;
}

/** A whole-row link that still renders valid table markup. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="block text-ink transition-colors hover:text-teal">
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ misc */

export function EmptyState({ icon = "grid", title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10 text-teal">
        <Icon name={icon} size={20} />
      </span>
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-ink-dim">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, max, tone = "teal" }: { value: number; max: number; tone?: "teal" | "good" | "warn" | "ember" }) {
  const pctVal = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bg = { teal: "bg-teal", good: "bg-good", warn: "bg-warn", ember: "bg-ember" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${pctVal}%` }} />
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-3">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                done ? "bg-good/20 text-good ring-1 ring-good/40"
                : active ? "bg-teal text-white"
                : "bg-white/5 text-ink-faint ring-1 ring-line"
              }`}
            >
              {done ? <Icon name="check" size={12} /> : i + 1}
            </span>
            <span className={`truncate text-xs ${active ? "font-semibold text-ink" : done ? "text-ink-dim" : "text-ink-faint"}`}>{s}</span>
            {i < steps.length - 1 && <span className="hidden h-px flex-1 bg-line sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{k}</dt>
          <dd className="mt-0.5 text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Money({ cents, exact = false, tone }: { cents: number; exact?: boolean; tone?: "good" | "bad" | "dim" }) {
  const cls = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "dim" ? "text-ink-dim" : "text-ink";
  return <span className={`font-mono tabular-nums ${cls}`}>{money(cents, exact)}</span>;
}

export function Bar({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-ink-dim">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-ink">{hint}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-teal to-teal-2" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

/**
 * Shown only when SUPABASE_URL is unset, i.e. the screen is rendering the
 * in-process seed rather than the database. With Postgres connected these rows
 * are real and no such banner appears.
 */
export function SeedNotice({ what, live }: { what: string; live: boolean }) {
  if (live) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3">
      <span className="mt-0.5 shrink-0 text-warn">
        <Icon name="alert" size={16} />
      </span>
      <p className="text-xs leading-relaxed text-ink-dim">
        <span className="font-semibold text-warn">Seed data.</span> {what} No database is configured,
        so these rows come from the built-in sample set and any change you make is lost when the
        server restarts. Set <span className="font-mono text-ink">SUPABASE_URL</span> to make them real.
      </p>
    </div>
  );
}
