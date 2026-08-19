"use server";

import { runOps } from "@/app/(app)/actions";

/**
 * The checklist is submitted from the field app, which lives outside the (app)
 * route group, so it keeps its own entry point. The work itself is the same
 * write every other control performs — required fields, the field-id key space
 * and the one-submission-per-visit rule are all enforced in the database.
 */
export async function saveChecklistAction(
  visitId: string,
  answers: Record<string, string>,
  submit: boolean
): Promise<{ ok: boolean; message: string }> {
  const { ok, message } = await runOps({ kind: "checklist.save", visitId, answers, submit });
  return { ok, message };
}
