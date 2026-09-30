import { PortalLoginForm } from "@/components/PortalLoginForm";
import { PortalFrame } from "@/components/PortalFrame";

export default function PortalLinkNotFound() {
  return (
    <PortalFrame>
      <div className="text-center">
        <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">This link has expired</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
          Project links stop working after a while, or when we send a newer one. Enter the email you gave us and we
          will send you a fresh link straight away.
        </p>
      </div>
      <PortalLoginForm initialEmail="" />
      <p className="mt-6 text-center text-xs leading-relaxed text-ink-faint">
        Need a hand? Call us on <a href="tel:+17276131415" className="text-teal">(727) 613-1415</a>.
      </p>
    </PortalFrame>
  );
}
