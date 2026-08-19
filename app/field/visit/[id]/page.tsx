import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Avatar, Badge, ProgressBar, StatusPill } from "@/components/ui";
import { QA_CHECKLIST, allFields } from "@/lib/forms";
import { OpsButton, OpsGroup } from "@/components/Ops";
import { CrewNotesForm } from "@/components/OpsForms";
import { checklistFor, clientName, db, getClient, getJob, getStaff, getVisit, propertyFor, ensureData } from "@/lib/db";
import { phoneDisplay, timeRange } from "@/lib/format";
import type { VisitStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// The visit's primary action, as a state machine. One button, one next step.
// Every target here is a row in 0001's status_transitions table; the database
// refuses anything else, so this list and that table have to agree.
const NEXT_ACTION: Partial<Record<VisitStatus, { label: string; to: VisitStatus }>> = {
  scheduled: { label: "I'm on my way", to: "en_route" },
  confirmed: { label: "I'm on my way", to: "en_route" },
  en_route: { label: "Arrived on site", to: "in_progress" },
};

export default async function FieldVisit({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const visit = getVisit(id);
  if (!visit) notFound();

  const client = getClient(visit.clientId);
  const prop = propertyFor(visit.clientId);
  const job = visit.jobId ? getJob(visit.jobId) : undefined;
  const crew = visit.assignedTo.map((sid) => getStaff(sid));
  const checklist = checklistFor(visit.id);
  const required = allFields(QA_CHECKLIST).filter((f) => f.required);
  const answered = checklist ? required.filter((f) => (checklist.answers[f.id] ?? "").trim()).length : 0;
  const openings = job ? db().quotes.find((q) => q.id === job.quoteId)?.openings ?? [] : [];

  const action = NEXT_ACTION[visit.status];
  const signedOff = checklist?.status === "submitted";
  const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(`${prop?.address}, ${prop?.city}, FL ${prop?.postalCode}`)}`;

  return (
    <>
      <Link href="/field" className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal">
        <Icon name="chevronLeft" size={12} /> Today
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tabular-nums text-teal">{timeRange(visit.scheduledStart, visit.scheduledEnd)}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">{clientName(visit.clientId)}</h1>
          <p className="text-sm text-ink-dim">{visit.title}</p>
        </div>
        <StatusPill status={visit.status} />
      </div>

      <OpsGroup className="mt-5">
        {action && (
          <OpsButton input={{ kind: "visit.status", id: visit.id, status: action.to }} variant="ember" size="lg" full>
            {action.label}
          </OpsButton>
        )}
        {visit.status === "in_progress" && signedOff && (
          <OpsButton input={{ kind: "visit.status", id: visit.id, status: "completed" }} variant="primary" size="lg" full>
            Finish the visit
          </OpsButton>
        )}
      </OpsGroup>

      {visit.status === "in_progress" && !signedOff && (
        <Link
          href={`/field/visit/${visit.id}/checklist`}
          className="mt-5 block w-full rounded-xl bg-teal py-4 text-center text-base font-semibold text-white"
        >
          Complete the checklist
        </Link>
      )}

      {/* address + contact */}
      <div className="panel mt-5 rounded-2xl p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Site</p>
        <p className="mt-1.5 text-sm text-ink">{prop?.address}</p>
        <p className="text-sm text-ink-dim">{prop?.city}, FL {prop?.postalCode}</p>
        <div className="mt-3 flex gap-2">
          <a href={mapsUrl} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-ink-dim transition-colors hover:border-line-bright hover:text-ink">
            <Icon name="pin" size={15} /> Directions
          </a>
          {client?.phone && (
            <a href={`tel:${client.phone}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-ink-dim transition-colors hover:border-line-bright hover:text-ink">
              <Icon name="phone" size={15} /> {phoneDisplay(client.phone)}
            </a>
          )}
        </div>
        {prop?.accessNotes && (
          <p className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <strong>Access:</strong> {prop.accessNotes}
          </p>
        )}
      </div>

      {job?.instructions && (
        <div className="panel mt-4 rounded-2xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Instructions</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{job.instructions}</p>
        </div>
      )}

      {/* scope */}
      {openings.length > 0 && (
        <div className="panel mt-4 rounded-2xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Scope — {openings.length} openings</p>
          <ul className="mt-2 flex flex-col gap-2">
            {openings.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-line/60 p-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{o.label}</span>
                  <span className="block font-mono text-[11px] text-ink-faint">
                    {o.widthIn}&quot; × {o.protectionHeightIn}&quot; · {o.panelCount} planks · {o.postCount} posts
                  </span>
                </span>
                {o.centerPostRequired && <Badge tone="ember">Centre post</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* checklist */}
      <Link href={`/field/visit/${visit.id}/checklist`} className="panel mt-4 block rounded-2xl p-4 transition-colors hover:border-line-bright">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Installation QA checklist</p>
          <Icon name="chevronRight" size={15} className="text-teal" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={answered} max={required.length} tone={answered === required.length ? "good" : "warn"} />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">{answered}/{required.length}</span>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {answered === required.length ? "Ready to sign off." : "A job can't be completed until every required check is done."}
        </p>
      </Link>

      {/* notes back to the office */}
      <div className="panel mt-4 rounded-2xl p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Notes for the office</p>
        <CrewNotesForm visitId={visit.id} current={visit.crewNotes ?? ""} />
      </div>

      {/* crew */}
      <div className="panel mt-4 rounded-2xl p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Crew</p>
        <div className="mt-2 flex flex-col gap-2">
          {crew.map((c) => c && (
            <span key={c.id} className="flex items-center gap-2.5">
              <Avatar name={c.name} size={26} color={c.color} />
              <span className="text-sm text-ink">{c.name}</span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
