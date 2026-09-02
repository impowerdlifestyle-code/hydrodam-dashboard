"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { removeItemAction } from "@/app/(app)/builder/actions";

type Row = { id: string; kind: string; key: string; name: string; status: string; created_by: string | null; created_at: string; summary: string; href?: string };

const KIND_LABEL: Record<string, string> = { template: "Template", automation: "Automation", checklist: "Checklist", layout: "Layout", build_request: "Build request" };
const KIND_TONE: Record<string, "teal" | "good" | "warn" | "neutral" | "bad"> = { template: "teal", automation: "good", checklist: "neutral", layout: "warn", build_request: "bad" };

export function BuiltItems({ rows }: { rows: Row[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) return <p className="text-sm text-ink-dim">Nothing built yet. Ask for something on the left.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-line/60 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {r.href ? <Link href={r.href} className="hover:text-teal">{r.name}</Link> : r.name}
                <Badge tone={KIND_TONE[r.kind] ?? "neutral"}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                {r.kind === "build_request" && <Badge tone={r.status === "done" ? "good" : "warn"}>{r.status}</Badge>}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">{r.summary}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                {r.key}{r.created_by ? ` · by ${r.created_by}` : ""}
              </p>
            </div>
            {r.kind !== "build_request" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => { setBusy(r.id); start(async () => { await removeItemAction(r.kind as "template", r.key); setBusy(null); }); }}
                className="shrink-0 rounded-lg border border-line/60 p-1.5 text-ink-faint transition-colors hover:border-bad/50 hover:text-bad disabled:opacity-50"
                aria-label={`Remove ${r.name}`}
              >
                <Icon name={busy === r.id ? "refresh" : "trash"} size={13} />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
