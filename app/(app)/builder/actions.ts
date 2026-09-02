"use server";

import { revalidatePath } from "next/cache";
import { removeItem, type Kind } from "@/lib/builder";
import { requireSession } from "@/lib/session";

export async function removeItemAction(kind: Kind, key: string): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  const ok = await removeItem(kind, key);
  revalidatePath("/builder");
  revalidatePath("/");
  revalidatePath("/automations");
  revalidatePath("/inbox");
  revalidatePath("/team");
  return ok ? { ok: true, message: "Removed." } : { ok: false, message: "Nothing to remove." };
}
