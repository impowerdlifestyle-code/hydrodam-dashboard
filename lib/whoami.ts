import "server-only";
import { cookies } from "next/headers";
import { db, ensureData, getStaff } from "@/lib/db";
import type { Role, Staff } from "@/lib/types";

/**
 * The dashboard has one shared password, so "who is looking" is a choice the
 * person makes in the sidebar, not an authenticated identity. It only decides
 * which Overview layout they see and whose name goes on things they build.
 */
export const WHO_COOKIE = "hd_who";

export async function currentStaff(): Promise<Staff | undefined> {
  await ensureData();
  const jar = await cookies();
  const id = jar.get(WHO_COOKIE)?.value;
  const staff = id ? getStaff(id) : undefined;
  return staff?.active ? staff : undefined;
}

export async function currentRole(): Promise<Role> {
  return (await currentStaff())?.role ?? "owner";
}

export function activeStaff(): Staff[] {
  return db().staff.filter((s) => s.active);
}
