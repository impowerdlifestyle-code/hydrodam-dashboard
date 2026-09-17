import type { ReactNode } from "react";

/** The customer-facing chrome shared by every /p page. */
export function PortalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <header className="flex items-center gap-2.5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" fill="#1f8ab3" opacity="0.22" />
          <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" stroke="#1f8ab3" strokeWidth="1.5" />
          <path d="M8 12h8M8 15h8" stroke="#cc551e" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="font-display text-base font-bold text-ink">HydroDam</span>
      </header>
      {children}
      <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-faint">
        <p>Hydro Dam LLC · 6140 Ulmerton Road, Clearwater FL 33760 · FL contractor CBC1269077</p>
        <p className="mt-1">Questions? Call (727) 613-1415 or reply to any of our emails.</p>
      </footer>
    </div>
  );
}
