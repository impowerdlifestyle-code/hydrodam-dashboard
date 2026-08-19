import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Avatar, EmptyState, StatusPill } from "@/components/ui";
import { clientName, getStaff, propertyFor, todaysVisits, ensureData } from "@/lib/db";
import { timeRange } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  assessment: "Assessment", measure: "Measure", install: "Install",
  service: "Service", thirty_day_check: "30-day check",
};

export default async function FieldToday() {
  await ensureData();
  const visits = todaysVisits().filter((v) => v.assignedTo.length > 0);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{today}</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-ink">Today&apos;s work</h1>

      <div className="mt-6 flex flex-col gap-3">
        {visits.length === 0 ? (
          <EmptyState icon="check" title="Nothing on today" body="Enjoy it." />
        ) : (
          visits.map((v) => {
            const prop = propertyFor(v.clientId);
            const crew = v.assignedTo.map((id) => getStaff(id));
            return (
              <Link key={v.id} href={`/field/visit/${v.id}`} className="panel block rounded-2xl p-4 transition-colors hover:border-line-bright">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tabular-nums text-teal">{timeRange(v.scheduledStart, v.scheduledEnd)}</p>
                    <p className="mt-1 font-display text-base font-bold text-ink">{clientName(v.clientId)}</p>
                    <p className="text-sm text-ink-dim">{KIND_LABEL[v.kind]} · {v.title}</p>
                  </div>
                  <StatusPill status={v.status} />
                </div>

                <p className="mt-3 flex items-start gap-2 text-sm text-ink-dim">
                  <span className="mt-0.5 shrink-0 text-ink-faint"><Icon name="pin" size={14} /></span>
                  <span>{prop?.address}, {prop?.city} {prop?.postalCode}</span>
                </p>

                {prop?.accessNotes && (
                  <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs text-warn">
                    {prop.accessNotes}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="flex gap-1">
                    {crew.map((c) => c && <Avatar key={c.id} name={c.name} size={22} color={c.color} />)}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal">
                    Open <Icon name="chevronRight" size={13} />
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}
