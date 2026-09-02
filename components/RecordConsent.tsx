"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { recordConsentAction } from "@/app/(app)/clients/[id]/consent-actions";

const SOURCES = [
  ["email_reply", "Said yes by email"],
  ["text_reply", "Said yes by text"],
  ["signed_agreement", "Ticked it on a signed form"],
  ["phone_call", "Told us on the phone"],
  ["in_person", "Told us in person"],
] as const;

const DEFAULT_WORDING = "Agreed to receive text messages from HydroDam about their project, appointments and occasional offers. Told they can reply STOP to opt out.";

export function RecordConsent({ clientId, hasPhone }: { clientId: string; hasPhone: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"transactional" | "marketing">("marketing");
  const [source, setSource] = useState<(typeof SOURCES)[number][0]>("email_reply");
  const [wording, setWording] = useState(DEFAULT_WORDING);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  if (!hasPhone) return <p className="mt-3 text-xs text-ink-faint">Add a mobile number before recording consent.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`mt-3 ${buttonClass("outline", "sm")}`}>
        <Icon name="edit" size={13} /> Record consent
      </button>
    );
  }

  const field = "w-full rounded-lg border border-line bg-abyss px-3 py-2 text-xs text-ink outline-none focus:border-teal disabled:opacity-60";
  const submit = (revoke = false) =>
    start(async () => {
      const res = await recordConsentAction({ clientId, kind, source, wording, revoke });
      setToast(res);
      if (res.ok) { setOpen(false); router.refresh(); }
    });

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-abyss-2/60 p-3">
      <div className="flex gap-1.5">
        {(["marketing", "transactional"] as const).map((k) => (
          <button key={k} type="button" disabled={pending} onClick={() => setKind(k)} className={`rounded-lg border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${kind === k ? "border-teal/60 text-teal" : "border-line/60 text-ink-faint"}`}>
            {k === "marketing" ? "Marketing + updates" : "Job updates only"}
          </button>
        ))}
      </div>
      <select value={source} disabled={pending} onChange={(e) => setSource(e.target.value as typeof source)} className={field} aria-label="How they said yes">
        {SOURCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <textarea value={wording} rows={3} disabled={pending} onChange={(e) => setWording(e.target.value)} className={`${field} resize-none`} aria-label="What they agreed to" />
      <p className="text-[11px] leading-relaxed text-ink-faint">Marketing texts need a written yes. A phone call can only grant job updates. The wording is kept as the record.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => submit(false)} className={buttonClass("primary", "sm")}><Icon name="check" size={13} /> Save consent</button>
        <button type="button" disabled={pending} onClick={() => submit(true)} className={buttonClass("ghost", "sm")}>Record opt-out</button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>Cancel</button>
      </div>
      {toast && <p className={`rounded-lg border px-3 py-2 text-xs ${toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{toast.message}</p>}
    </div>
  );
}
