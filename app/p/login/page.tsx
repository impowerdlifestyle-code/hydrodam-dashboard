import { PortalLoginForm } from "@/components/PortalLoginForm";
import { PortalFrame } from "@/components/PortalFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in to your HydroDam project", robots: { index: false, follow: false } };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <PortalFrame>
      <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">Your HydroDam project</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
        Sign in with your email and password to see where things stand, your assessment booking, your estimate
        and your documents. If this is your first visit, enter the email you gave us and we will send a link to set
        up your account.
      </p>
      <PortalLoginForm initialEmail={email ?? ""} />
      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        Not a HydroDam customer yet? Get an instant estimate at{" "}
        <a href="https://thehydrodam.com/estimate" className="text-teal">thehydrodam.com/estimate</a> and your
        project is created for you.
      </p>
    </PortalFrame>
  );
}
