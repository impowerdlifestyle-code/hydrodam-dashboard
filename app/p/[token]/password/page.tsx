import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalAccountForm } from "@/components/PortalAccountForm";
import { PortalFrame } from "@/components/PortalFrame";
import { ensureData, getClient } from "@/lib/db";
import { portalGate } from "@/lib/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password · HydroDam", robots: { index: false, follow: false } };

export default async function PortalPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const gate = await portalGate(token);
  if (!gate) notFound();

  await ensureData();
  const email = getClient(gate.clientId)?.email ?? "";

  return (
    <PortalFrame>
      <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">Choose a new password</h1>
      {gate.fresh ? (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
            This replaces the password on your HydroDam account. You will use it with your email the next time you
            sign in.
          </p>
          <PortalAccountForm token={token} email={email} mode="reset" />
        </>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
          For your security, changing a password needs a link from the last hour.{" "}
          <Link href="/p/login" className="text-teal">Ask for a fresh one</Link>.
        </p>
      )}
      <p className="mt-6 text-xs text-ink-faint">
        <Link href={`/p/${token}`} className="text-teal">Skip this and open my project</Link>
      </p>
    </PortalFrame>
  );
}
