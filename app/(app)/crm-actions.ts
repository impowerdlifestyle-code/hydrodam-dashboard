"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { invalidate, invalidateCrm, ensureData } from "@/lib/db";
import { requireSession } from "@/lib/session";

/** "Refresh from HubSpot" on the Requests and Clients pages. */
export async function refreshCrmAction(): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  revalidateTag("crm", "max");
  invalidateCrm();
  invalidate();
  await ensureData();
  revalidatePath("/", "layout");
  return { ok: true, message: "Refreshed from HubSpot." };
}
