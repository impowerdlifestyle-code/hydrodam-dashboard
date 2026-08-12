import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";

export const metadata = { title: "HydroDam Field", robots: { index: false, follow: false } };

const TABS = [
  { href: "/field", label: "Today", icon: "calendar" },
  { href: "/field/clock", label: "Clock", icon: "clock" },
  { href: "/", label: "Office", icon: "grid" },
];

export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/field" className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" fill="#1f8ab3" opacity="0.22" />
            <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" stroke="#1f8ab3" strokeWidth="1.5" />
          </svg>
          <span className="font-display text-sm font-bold text-ink">HydroDam <span className="text-ember">Field</span></span>
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Crew</span>
      </header>

      <main className="flex-1 px-4 pb-24 pt-5">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg border-t border-line bg-abyss-2/95 backdrop-blur">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="flex flex-1 flex-col items-center gap-1 py-3 text-ink-dim transition-colors hover:text-ink">
            <Icon name={t.icon} size={19} />
            <span className="font-mono text-[10px] uppercase tracking-wider">{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
