"use server";

import { revalidatePath } from "next/cache";
import { AUDIENCES, planCampaign, sendCampaign, type Audience, type Plan, type SendSummary } from "@/lib/campaigns";
import { hasSession } from "@/lib/session";

const isAudience = (a: string): a is Audience => a in AUDIENCES;

export async function planCampaignAction(audience: string, text: string): Promise<Plan | { blocked: string }> {
  if (!(await hasSession())) return { blocked: "Signed out." };
  if (!isAudience(audience)) return { blocked: "Pick an audience." };
  if (!text.trim()) return { blocked: "Write the message first." };
  return planCampaign(audience, text);
}

export async function sendCampaignAction(name: string, audience: string, text: string): Promise<SendSummary> {
  const fail = (message: string): SendSummary => ({ ok: false, message, sent: 0, failed: 0, skipped: 0 });
  if (!(await hasSession())) return fail("Signed out.");
  if (!isAudience(audience)) return fail("Pick an audience.");
  if (!name.trim()) return fail("Give the campaign a name so it shows in the log.");
  if (!text.trim()) return fail("Write the message first.");
  const res = await sendCampaign(name.trim(), audience, text);
  revalidatePath("/campaigns");
  revalidatePath("/inbox");
  return res;
}
