"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { approveFromPortal } from "@/app/p/[token]/approve/actions";

/**
 * The customer's signature block.
 *
 * The warranty and terms are rendered in the page above this, not linked as a
 * download, so the signing record can state exactly what they had in front of
 * them. Typing the name is the signature; the tick is the ESIGN consent. Both
 * are required, and the wording of both is stored verbatim with the record.
 */
export function PortalApproval({
  token,
  quoteId,
  consentText,
  acknowledgment,
  suggestedName,
}: {
  token: string;
  quoteId: string;
  consentText: string;
  acknowledgment: string;
  suggestedName: string;
}) {
  const [name, setName] = useState(suggestedName);
  const [consented, setConsented] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (result?.ok) {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-good/30 bg-good/10 p-5">
        <span className="mt-0.5 shrink-0 text-good"><Icon name="check" size={18} /></span>
        <p className="text-sm leading-relaxed text-good">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="panel mt-6 rounded-2xl p-5">
      <p className="text-sm leading-relaxed text-ink">{acknowledgment}</p>

      <label className="mt-5 flex items-start gap-3">
        <input
          type="checkbox"
          checked={consented}
          disabled={pending}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
        />
        <span className="text-xs leading-relaxed text-ink-dim">{consentText}</span>
      </label>

      <div className="mt-5">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          Type your full name
        </span>
        <input
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 font-display text-lg text-ink outline-none focus:border-teal disabled:opacity-50"
          autoComplete="name"
        />
      </div>

      <button
        type="button"
        disabled={pending || !consented || name.trim().length < 2}
        className="mt-4 w-full rounded-xl bg-teal py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        onClick={() =>
          startTransition(async () => {
            const res = await approveFromPortal(token, quoteId, name, consented);
            setResult(res);
            if (res.ok) router.refresh();
          })
        }
      >
        {pending ? "Recording…" : "Approve and sign"}
      </button>

      {result && !result.ok && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/[0.06] px-3 py-2 text-xs text-bad">
          <span className="mt-px shrink-0"><Icon name="alert" size={13} /></span>
          {result.message}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Your name, the date, your IP address and the exact version of this agreement are recorded
        with the signature.
      </p>
    </div>
  );
}
