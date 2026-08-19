import "server-only";
import { cookies } from "next/headers";

/**
 * The authorization boundary.
 *
 * `proxy.ts` keeps unauthenticated browsers out of the UI, but it is a matcher
 * over pathnames and server actions are POSTs to whatever route declared them —
 * a matcher edit can drop coverage without anything visibly breaking. So every
 * action that touches data calls this first. It is the same cookie check, done
 * where it cannot be routed around.
 */

const SESSION_COOKIE = "hd_session";

const secret = (): string => process.env.SESSION_SECRET ?? "hydrodam-ops-dev";

export async function hasSession(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value === secret();
}

export async function requireSession(): Promise<void> {
  if (!(await hasSession())) throw new Error("Not signed in.");
}
