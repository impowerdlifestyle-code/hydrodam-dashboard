import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ChecklistForm } from "@/components/ChecklistForm";
import { checklistFor, clientName, getVisit, ensureData } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureData();
  const { id } = await params;
  const visit = getVisit(id);
  if (!visit) notFound();

  const existing = checklistFor(visit.id);

  return (
    <>
      <Link href={`/field/visit/${visit.id}`} className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal">
        <Icon name="chevronLeft" size={12} /> Visit
      </Link>

      <h1 className="font-display text-xl font-bold text-ink">QA checklist</h1>
      <p className="text-sm text-ink-dim">{clientName(visit.clientId)} · {visit.title}</p>

      <ChecklistForm
        visitId={visit.id}
        initial={existing?.answers ?? {}}
        submitted={existing?.status === "submitted"}
      />
    </>
  );
}
