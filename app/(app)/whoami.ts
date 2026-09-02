"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { WHO_COOKIE } from "@/lib/whoami";

export async function setWhoAmI(staffId: string): Promise<void> {
  await requireSession();
  const jar = await cookies();
  if (staffId) jar.set(WHO_COOKIE, staffId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  else jar.delete(WHO_COOKIE);
  revalidatePath("/", "layout");
}
