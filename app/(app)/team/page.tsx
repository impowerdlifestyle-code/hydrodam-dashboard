import { Avatar, Badge, PageHeader, Panel, ProgressBar, SectionLabel, StatCard, Table, Td, Th } from "@/components/ui";
import { OpsButton } from "@/components/Ops";
import { AddTeammateForm } from "@/components/OpsForms";
import { crewUtilization, db, getStaff, ensureData } from "@/lib/db";
import { hoursMinutes, money, phoneDisplay, relative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team · HydroDam Ops" };

const ROLE_TONE = { owner: "ember", office: "teal", crew: "neutral" } as const;

export default async function TeamPage() {
  await ensureData();
  const d = db();
  const util = crewUtilization();
  const totalMinutes = util.reduce((s, u) => s + u.minutes, 0);
  const totalCost = util.reduce((s, u) => s + u.costCents, 0);
  const running = d.timeEntries.filter((t) => !t.endedAt);

  return (
    <>
      <PageHeader title="Team" subtitle="Roles, cost rates and the hours that feed job costing." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="On the clock now" value={running.length} sub={running.map((r) => getStaff(r.userId)?.name.split(" ")[0]).join(", ") || "nobody"} accent={running.length ? "warn" : "teal"} />
        <StatCard label="Hours logged" value={hoursMinutes(totalMinutes)} sub="all recorded time" />
        <StatCard label="Labor cost" value={money(totalCost)} sub="at each person's cost rate" accent="ember" />
      </div>

      <Panel className="mt-6">
        <SectionLabel>Add someone</SectionLabel>
        <AddTeammateForm />
      </Panel>

      <Panel className="mt-6">
        <SectionLabel>Staff</SectionLabel>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Contact</Th>
              <Th align="right">Cost rate</Th>
              <Th align="right">Hours</Th>
              <Th align="right">Labor cost</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {d.staff.map((s) => {
              const u = util.find((x) => x.staffId === s.id);
              return (
                <tr key={s.id} className="text-ink-dim">
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={s.name} size={28} color={s.color} />
                      <span className="text-sm font-semibold text-ink">{s.name}</span>
                    </span>
                  </Td>
                  <Td><Badge tone={ROLE_TONE[s.role]}>{s.role}</Badge></Td>
                  <Td className="text-xs">
                    {s.email}
                    <span className="block text-ink-faint">{phoneDisplay(s.phone)}</span>
                  </Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">
                    {s.costRateCentsPerHour ? `${money(s.costRateCentsPerHour, true)}/h` : "—"}
                  </Td>
                  <Td align="right" className="font-mono text-xs tabular-nums">{u ? hoursMinutes(u.minutes) : "—"}</Td>
                  <Td align="right" className="font-mono text-xs tabular-nums text-ink">{u ? money(u.costCents) : "—"}</Td>
                  <Td align="right">
                    <OpsButton
                      input={{ kind: "team.active", id: s.id, active: !s.active }}
                      variant="ghost"
                      confirm={s.active ? "Confirm" : undefined}
                    >
                      {s.active ? "Deactivate" : "Reactivate"}
                    </OpsButton>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionLabel>Crew utilisation</SectionLabel>
          <div className="flex flex-col gap-4">
            {util.map((u) => {
              const s = getStaff(u.staffId);
              const pctOf40 = Math.min(100, Math.round((u.minutes / 60 / 40) * 100));
              return (
                <div key={u.staffId}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 text-ink">
                      <Avatar name={u.name} size={20} color={s?.color} /> {u.name}
                    </span>
                    <span className="font-mono tabular-nums text-ink-dim">{hoursMinutes(u.minutes)} · {pctOf40}%</span>
                  </div>
                  <ProgressBar value={u.minutes / 60} max={40} tone={pctOf40 > 80 ? "good" : pctOf40 > 40 ? "teal" : "warn"} />
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-ink-faint">Against a nominal 40-hour week.</p>
        </Panel>

        <Panel>
          <SectionLabel>Recent time entries</SectionLabel>
          <ul className="flex flex-col gap-2">
            {[...d.timeEntries].reverse().slice(0, 8).map((t) => {
              const s = getStaff(t.userId);
              const mins = t.endedAt ? Math.max(0, (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 - t.breakMinutes) : 0;
              const job = d.jobs.find((j) => j.id === t.jobId);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-line/60 p-2.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={s?.name ?? "?"} size={22} color={s?.color} />
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{s?.name}</span>
                      <span className="block truncate text-ink-faint">
                        {job ? `Job #${job.number}` : "No job"} · {t.activity}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono tabular-nums">
                    {t.endedAt ? (
                      <span className="text-ink">{hoursMinutes(mins)}</span>
                    ) : (
                      <span className="text-warn">running · {relative(t.startedAt)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
