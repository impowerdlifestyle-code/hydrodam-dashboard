import { Avatar, StatusPill } from "@/components/ui";
import { ClockControl } from "@/components/OpsForms";
import { clientName, db, getStaff, openTimeEntry, todaysVisits, ensureData } from "@/lib/db";
import { dayKey, hoursMinutes, money, timeOfDay, todayKey } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClockPage() {
  await ensureData();
  const d = db();
  const crew = d.staff.filter((s) => s.role === "crew");
  const today = todaysVisits();

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-ink">Time clock</h1>
      <p className="text-sm text-ink-dim">Hours here feed job costing and payroll.</p>

      <div className="mt-6 flex flex-col gap-3">
        {crew.map((s) => {
          const open = openTimeEntry(s.id);
          const todayEntries = d.timeEntries.filter(
            // "Today" is today in Clearwater; on Vercel the server clock is UTC,
            // which would roll the crew's day over at 8pm.
            (t) => t.userId === s.id && dayKey(t.startedAt) === todayKey()
          );
          const minutes = todayEntries.reduce((sum, t) => {
            if (!t.endedAt) return sum + (Date.now() - Date.parse(t.startedAt)) / 60_000;
            return sum + Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 - t.breakMinutes);
          }, 0);
          const job = open?.jobId ? d.jobs.find((j) => j.id === open.jobId) : undefined;
          // Clocking in attaches to whatever this person is next on site for, so
          // the hours land on the right job without anyone picking from a list.
          const nextVisit = today.find((v) => v.assignedTo.includes(s.id));
          const openJob = nextVisit?.jobId ? d.jobs.find((j) => j.id === nextVisit.jobId) : undefined;

          return (
            <div key={s.id} className="panel rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <Avatar name={s.name} size={34} color={s.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-bold text-ink">{s.name}</p>
                  <p className="text-xs text-ink-faint">
                    {open ? (
                      <>On the clock since {timeOfDay(open.startedAt)}{job ? ` · Job #${job.number}` : ""}</>
                    ) : (
                      "Clocked out"
                    )}
                  </p>
                </div>
                <StatusPill status={open ? "in_progress" : "completed"} />
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Today</span>
                <span className="font-mono text-sm tabular-nums text-ink">{hoursMinutes(minutes)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Cost rate</span>
                <span className="font-mono text-sm tabular-nums text-ink-dim">{money(s.costRateCentsPerHour, true)}/h</span>
              </div>

              <div className="mt-3">
                <ClockControl
                  userId={s.id}
                  jobId={openJob?.id}
                  visitId={nextVisit?.id}
                  open={Boolean(open)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel mt-6 rounded-2xl p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Today&apos;s visits</p>
        <ul className="mt-2 flex flex-col gap-2">
          {today.map((v) => (
            <li key={v.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[11px] tabular-nums text-teal">{timeOfDay(v.scheduledStart)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-dim">{clientName(v.clientId)}</span>
              <span className="shrink-0">
                {v.assignedTo.map((id) => {
                  const s = getStaff(id);
                  return s ? <Avatar key={id} name={s.name} size={18} color={s.color} /> : null;
                })}
              </span>
            </li>
          ))}
          {today.length === 0 && <li className="text-sm text-ink-faint">Nothing scheduled.</li>}
        </ul>
      </div>
    </>
  );
}
