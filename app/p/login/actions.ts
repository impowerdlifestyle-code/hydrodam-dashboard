"use server";

import { headers } from "next/headers";
import { requestPortalLogin } from "@/lib/portal";

export async function sendPortalLink(email: string): Promise<{ ok: boolean; message: string }> {
  const head = await headers();
  const result = await requestPortalLogin(email, {
    ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: head.get("user-agent") ?? undefined,
  });

  if (result.reason === "invalid") return { ok: false, message: "Please enter the email address you gave HydroDam." };
  if (result.reason === "rate_limited") {
    return { ok: false, message: "We have already sent a few links to that address. Check your inbox and spam folder, or try again in 15 minutes." };
  }
  // Matched or not, the browser hears the same thing.
  return {
    ok: true,
    message: "If we have a project under that email, your link is on its way. It can take a minute to arrive.",
  };
}
