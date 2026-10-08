import type { ReactNode } from "react";
import { PortalAccountForm } from "@/components/PortalAccountForm";
import { PortalFrame } from "@/components/PortalFrame";
import { DB_LIVE, ensureData, getClient } from "@/lib/db";
import { portalGate } from "@/lib/portal";

/**
 * The first time a customer opens a link they choose a password before they
 * see anything else, so the portal has a way back in that does not depend on
 * finding an old email. A dead token falls through to the page, which 404s.
 */
export default async function PortalTokenLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const gate = DB_LIVE ? await portalGate(token) : null;
  if (!gate || gate.hasAccount) return children;

  await ensureData();
  if (!getClient(gate.clientId)) await ensureData({ fresh: true });
  const client = getClient(gate.clientId);
  const firstName = client?.name.trim().split(/\s+/)[0];

  return (
    <PortalFrame>
      <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">
        {firstName ? `Welcome, ${firstName}` : "Welcome"}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
        Set up your HydroDam account to open your project. Choose a password and you can sign in any time to see
        where things stand, book your assessment, and find your estimate and documents.
      </p>
      <PortalAccountForm token={token} email={client?.email ?? ""} mode="setup" />
    </PortalFrame>
  );
}
