"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { NAV } from "@/lib/data";
import { Icon } from "@/components/Icon";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
              active ? "bg-teal/15 font-semibold text-ink ring-1 ring-line-bright" : "text-ink-dim hover:bg-white/5 hover:text-ink"
            }`}
          >
            <Icon name={item.icon} className={active ? "text-teal" : ""} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* mobile bar */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 lg:hidden">
        <Brand />
        <button onClick={() => setOpen((v) => !v)} aria-label="Menu" className="rounded-lg border border-line p-2 text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={open ? "M6 6l12 12M18 6L6 18" : "M3 6h18M3 12h18M3 18h18"} /></svg>
        </button>
      </div>
      {open && <div className="border-b border-line p-3 lg:hidden">{nav}</div>}

      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-abyss-2/40 p-4 lg:flex">
        <Brand />
        <div className="mt-6 flex-1">{nav}</div>
        <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-ink-faint transition-colors hover:bg-white/5 hover:text-ink">
          <Icon name="logout" /> Sign out
        </button>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" fill="#1f8ab3" opacity="0.22" />
        <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" stroke="#1f8ab3" strokeWidth="1.5" />
        <path d="M8 12h8M8 15h8" stroke="#cc551e" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-display text-[15px] font-bold text-ink">HydroDam <span className="text-teal">Ops</span></span>
    </Link>
  );
}
