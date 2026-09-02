"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { refreshCrmAction } from "@/app/(app)/crm-actions";

export function RefreshCrm() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      {note && <span className="text-xs text-ink-faint">{note}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await refreshCrmAction(); setNote(r.message); router.refresh(); })}
        className={buttonClass("outline", "sm")}
      >
        <Icon name="refresh" size={13} /> {pending ? "Pulling from HubSpot…" : "Refresh from HubSpot"}
      </button>
    </span>
  );
}
