"use server";

import { revalidatePath } from "next/cache";
import { syncQuickBooksEstimates } from "@/lib/quickbooks";
import { requireSession } from "@/lib/session";

export async function syncNowAction(): Promise<void> {
  await requireSession();
  await syncQuickBooksEstimates();
  revalidatePath("/quickbooks");
}
