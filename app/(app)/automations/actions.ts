"use server";

import { revalidatePath } from "next/cache";
import { ensureData } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { checkWording, describeTiming, toFriendly, toRaw } from "@/lib/sms-wording";
import { clearOverride, logChange, saveOverride, saveTiming, textFlow } from "@/lib/text-automations";
import { currentStaff } from "@/lib/whoami";

type Result = { ok: boolean; message: string };

function refresh(key: string) {
  revalidatePath("/automations");
  revalidatePath(`/automations/${key}`);
}

/** Saves the office's wording for one text. The same checks the editor shows run again here. */
export async function saveWordingAction(key: string, friendly: string): Promise<Result> {
  await requireSession();
  await ensureData();
  const flow = await textFlow(key);
  if (!flow) return { ok: false, message: "That automation no longer exists." };

  const check = checkWording(friendly, flow.tokens, flow.marketing);
  if (check.errors.length) return { ok: false, message: check.errors.join(" ") };

  const raw = toRaw(friendly.trim());
  const who = (await currentStaff())?.name;
  const before = flow.override?.body ?? null;
  if (before === raw) return { ok: true, message: "No changes to save." };

  await saveOverride(key, flow.name, raw, who);
  await logChange(key, who, `Changed the wording of "${flow.name}"`, { before: before ? toFriendly(before) : "built-in wording", after: friendly.trim() });
  refresh(key);
  return { ok: true, message: "Saved. The next text uses this wording." };
}

export async function resetWordingAction(key: string): Promise<Result> {
  await requireSession();
  await ensureData();
  const flow = await textFlow(key);
  if (!flow?.override) return { ok: true, message: "Already using the built-in wording." };
  const who = (await currentStaff())?.name;
  await clearOverride(key);
  await logChange(key, who, `Put "${flow.name}" back to the built-in wording`, { before: toFriendly(flow.override.body), after: "built-in wording" });
  refresh(key);
  return { ok: true, message: "Back to the built-in wording." };
}

/** Days are relative to the flow's anchor: negative is before it, positive after. */
export async function saveTimingAction(key: string, offsets: number[]): Promise<Result> {
  await requireSession();
  await ensureData();
  const flow = await textFlow(key);
  if (!flow?.automation || !flow.anchor) return { ok: false, message: "This text has no timing to change." };

  const clean = [...new Set(offsets)].sort((a, b) => a - b);
  if (!clean.length) return { ok: false, message: "Pick at least one day." };
  if (clean.length > 6) return { ok: false, message: "Six sends is the most one automation can make." };
  if (clean.some((n) => !Number.isInteger(n) || Math.abs(n) > 90)) return { ok: false, message: "Use whole days, up to 90." };
  if (!flow.before && clean.some((n) => n < 0)) return { ok: false, message: `This one can only go out on or after ${flow.anchor}.` };
  if (!flow.after && clean.some((n) => n > 0)) return { ok: false, message: `This one can only go out on or before ${flow.anchor.replace(/^the day of /, "")}.` };

  const before = flow.automation.offsetsDays;
  if (before.join(",") === clean.join(",")) return { ok: true, message: "No changes to save." };
  const who = (await currentStaff())?.name;
  await saveTiming(key, clean);
  await logChange(key, who, `Changed when "${flow.name}" goes out`, {
    before: describeTiming(before, flow.anchor),
    after: describeTiming(clean, flow.anchor),
  });
  refresh(key);
  return { ok: true, message: `Saved. ${describeTiming(clean, flow.anchor)}` };
}
