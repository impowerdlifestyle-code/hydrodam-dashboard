import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, PageHeader, Panel, SectionLabel, StatusPill } from "@/components/ui";
import { clientName, db, getStaff, propertyFor, visitsBetween } from "@/lib/db";
import { timeOfDay, timeRange } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule · HydroDam Ops" };

const DAY_MS = 86_400_000;
const KIND_LABEL: Record<string, string> = {
  assessment: "Assessment", measure: "Measure", install: "Install",
  service: "Service", thirty_day_check: "30-day check",
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ w?: string; view?: string }> }) {
  const { w = "0", view = "week" } = await searchParams;
  const weekOffset = Number.parseInt(w, 10) || 0;
  const weekStart = new Date(startOfWeek(new Date()).getTime() + weekOffset * 7 * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const visits = visitsBetween(weekStart.toISOString(), weekEnd.toISOString());
  const crew = db().staff.filter((s) => s.role === "crew");
  const unassigned = db().visits.filter((v) => v.status === "unscheduled" || v.assignedTo.length === 0);

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS));
  const todayKey = new Date().toDateString();

  const dayView = view === "day";
  const dayDate = days.find((d) => d.toDateString() === todayKey) ?? days[1];

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Dispatch board — every visit, every crew, one week at a time."
        action={
          <div className="flex items-center gap-2">
            <Link href={`/schedule?w=${weekOffset - 1}&view=${view}`} className="rounded-lg border border-line p-2 text-ink-dim transition-colors hover:border-line-bright hover:text-ink" aria-label="Previous week">
              <Icon name="chevronLeft" size={15} />
            </Link>
            <Link href={`/schedule?view=${view}`} className="rounded-lg border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim transition-colors hover:border-line-bright hover:text-ink">
              Today
            </Link>
            <Link href={`/schedule?w=${weekOffset + 1}&view=${view}`} className="rounded-lg border border-line p-2 text-ink-dim transition-colors hover:border-line-bright hover:text-ink" aria-label="Next week">
              <Icon name="chevronRight" size={15} />
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-lg font-semibold text-ink">
          {weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} –{" "}
          {new Date(weekEnd.getTime() - DAY_MS).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>
        <div className="flex gap-2">
          {(["week", "day"] as const).map((v) => (
            <Link
              key={v}
              href={`/schedule?w=${weekOffset}&view=${v}`}
              className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                v === view ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint hover:bg-white/5 hover:text-ink"
              }`}
            >
              {v}
            </Link>
          ))}
        </div>
      </div>

      {dayView ? (
        <DayBoard date={dayDate} crew={crew} />
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <div className="grid min-w-[900px] grid-cols-7 gap-2">
            {days.map((day) => {
              const dayVisits = visits.filter((v) => new Date(v.scheduledStart).toDateString() === day.toDateString());
              const isToday = day.toDateString() === todayKey;
              return (
                <div key={day.toISOString()} className={`rounded-2xl border p-2.5 ${isToday ? "border-line-bright bg-teal/5" : "border-line bg-abyss-2/30"}`}>
                  <p className={`mb-2.5 font-mono text-[10px] uppercase tracking-widest ${isToday ? "text-teal" : "text-ink-faint"}`}>
                    {day.toLocaleDateString("en-US", { weekday: "short" })} {day.getDate()}
                  </p>
                  <div className="flex min-h-[7rem] flex-col gap-1.5">
                    {dayVisits.length === 0 ? (
                      <p className="pt-2 text-center font-mono text-[10px] uppercase tracking-wider text-ink-faint/60">Open</p>
                    ) : (
                      dayVisits.map((v) => {
                        const c = v.assignedTo.map((id) => getStaff(id));
                        const lead = c[0];
                        return (
                          <Link
                            key={v.id}
                            href={v.jobId ? `/jobs/${v.jobId}` : `/clients/${v.clientId}`}
                            className="block rounded-lg border-l-2 bg-white/[0.04] p-2 transition-colors hover:bg-white/[0.08]"
                            style={{ borderLeftColor: lead?.color ?? "#5f7385" }}
                          >
                            <span className="block font-mono text-[10px] tabular-nums text-teal">{timeOfDay(v.scheduledStart)}</span>
                            <span className="mt-0.5 block truncate text-xs font-semibold text-ink">{clientName(v.clientId)}</span>
                            <span className="block truncate text-[11px] text-ink-faint">{KIND_LABEL[v.kind] ?? v.kind}</span>
                            <span className="mt-1.5 flex items-center gap-1">
                              {c.map((s) => s && <Avatar key={s.id} name={s.name} size={18} color={s.color} />)}
                            </span>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionLabel>Crew this week</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {crew.map((s) => {
              const mine = visits.filter((v) => v.assignedTo.includes(s.id));
              const hours = mine.reduce((sum, v) => sum + (Date.parse(v.scheduledEnd) - Date.parse(v.scheduledStart)) / 3_600_000, 0);
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-line/70 p-3">
                  <Avatar name={s.name} size={30} color={s.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-faint">{mine.length} visits · {hours.toFixed(1)}h booked</span>
                  </span>
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-white/5">
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (hours / 40) * 100)}%`, background: s.color }} />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-dim">{Math.round((hours / 40) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <SectionLabel>Unassigned</SectionLabel>
          {unassigned.length === 0 ? (
            <EmptyState icon="check" title="Everything's assigned" />
          ) : (
            <ul className="flex flex-col gap-2">
              {unassigned.map((v) => (
                <li key={v.id} className="rounded-xl border border-dashed border-ember/40 bg-ember/5 p-3">
                  <p className="text-sm font-semibold text-ink">{clientName(v.clientId)}</p>
                  <p className="text-xs text-ink-dim">{v.title}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">{propertyFor(v.clientId)?.city}</p>
                  <div className="mt-2"><StatusPill status={v.status} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function DayBoard({ date, crew }: { date: Date; crew: ReturnType<typeof db>["staff"] }) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  const visits = visitsBetween(start.toISOString(), end.toISOString());

  const HOUR_START = 7;
  const HOUR_END = 18;
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const PX_PER_HOUR = 56;

  return (
    <Panel className="overflow-hidden">
      <SectionLabel>{date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</SectionLabel>
      <div className="-mx-5 overflow-x-auto px-5">
        <div className="min-w-[680px]">
          <div className="flex" style={{ paddingLeft: 52 }}>
            {crew.map((s) => (
              <div key={s.id} className="flex flex-1 items-center gap-2 pb-2">
                <Avatar name={s.name} size={22} color={s.color} />
                <span className="truncate text-xs font-semibold text-ink">{s.name.split(" ")[0]}</span>
              </div>
            ))}
          </div>
          <div className="relative flex" style={{ height: hours.length * PX_PER_HOUR }}>
            {/* hour gutter */}
            <div className="w-[52px] shrink-0">
              {hours.map((h) => (
                <div key={h} className="relative" style={{ height: PX_PER_HOUR }}>
                  <span className="absolute -top-1.5 right-2 font-mono text-[10px] tabular-nums text-ink-faint">
                    {h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}
                  </span>
                </div>
              ))}
            </div>
            {/* crew columns */}
            {crew.map((s) => {
              const mine = visits.filter((v) => v.assignedTo.includes(s.id));
              return (
                <div key={s.id} className="relative flex-1 border-l border-line">
                  {hours.map((h) => (
                    <div key={h} className="border-b border-line/40" style={{ height: PX_PER_HOUR }} />
                  ))}
                  {mine.map((v) => {
                    const startD = new Date(v.scheduledStart);
                    const endD = new Date(v.scheduledEnd);
                    const top = (startD.getHours() + startD.getMinutes() / 60 - HOUR_START) * PX_PER_HOUR;
                    const height = Math.max(28, ((endD.getTime() - startD.getTime()) / 3_600_000) * PX_PER_HOUR - 3);
                    return (
                      <Link
                        key={v.id}
                        href={v.jobId ? `/jobs/${v.jobId}` : `/clients/${v.clientId}`}
                        className="absolute left-1 right-1 overflow-hidden rounded-lg border-l-2 p-1.5 transition-opacity hover:opacity-80"
                        style={{ top, height, background: `${s.color}22`, borderLeftColor: s.color }}
                      >
                        <span className="block truncate text-[11px] font-semibold text-ink">{clientName(v.clientId)}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-dim">{timeRange(v.scheduledStart, v.scheduledEnd)}</span>
                        <span className="block truncate text-[10px] text-ink-faint">{KIND_LABEL[v.kind]}</span>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
