"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { setWhoAmI } from "@/app/(app)/whoami";

export type WhoOption = { id: string; name: string; role: string };

export function WhoAmI({ options, current }: { options: WhoOption[]; current?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] text-ink-faint">
      <Icon name="user" size={17} />
      <select
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => { const id = e.target.value; start(async () => { await setWhoAmI(id); router.refresh(); }); }}
        className="w-full min-w-0 truncate bg-transparent text-[13px] text-ink-dim outline-none"
        aria-label="Who is using the dashboard"
      >
        <option value="">Who are you?</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
      </select>
    </label>
  );
}
