"use server";

import { revalidatePath } from "next/cache";
import { getVisit, saveChecklist } from "@/lib/db";

export async function saveChecklistAction(
  visitId: string,
  answers: Record<string, string>,
  submit: boolean
): Promise<{ ok: boolean; message: string }> {
  const visit = getVisit(visitId);
  if (!visit?.jobId) return { ok: false, message: "This visit isn't attached to a job." };

  const installer = (answers.installer ?? "").trim();
  if (submit && !installer) return { ok: false, message: "Installer name is required to sign off." };

  saveChecklist(visit.jobId, visitId, answers, submit, installer || "Crew");

  revalidatePath(`/field/visit/${visitId}`);
  revalidatePath(`/field/visit/${visitId}/checklist`);
  revalidatePath(`/jobs/${visit.jobId}`);

  return {
    ok: true,
    message: submit ? "Installation signed off." : "Progress saved.",
  };
}
