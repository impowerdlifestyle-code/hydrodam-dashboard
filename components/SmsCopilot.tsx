"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { rejectDraftAction, sendDraftAction } from "@/app/(app)/texts/actions";
import { segmentsFor } from "@/lib/format";

export type CopilotKind = { id: string; label: string; marketing: boolean; blocked?: string };
type Draft = { id: string; kind: string; text: string; warnings: string[] };
type Toast = { ok: boolean; message: string };

export function SmsCopilot({
  clientId,
  kinds,
  defaultKind,
  sendBlocker,
  optOutLine,
  trainingCount,
}: {
  clientId: string;
  kinds: CopilotKind[];
  defaultKind: string;
  sendBlocker?: string;
  optOutLine: string;
  trainingCount: number;
}) {
  const [kindId, setKindId] = useState(defaultKind);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const router = useRouter();

  const selected = kinds.find((k) => k.id === (draft?.kind ?? kindId)) ?? kinds[0];
  const busy = drafting || pending;
  const outgoing = selected.marketing && body.trim() && !/\bstop\b/i.test(body) ? `${body.trim()} ${optOutLine}` : body.trim();
  const count = segmentsFor(outgoing);
  const blockers = [selected.blocked, sendBlocker].filter(Boolean) as string[];

  async function generate() {
    setDrafting(true);
    setToast(null);
    setRejecting(false);
    try {
      const res = await fetch("/api/sms-copilot/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, kind: kindId, instruction: instruction || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Drafting failed.");
      setDraft({ id: json.draftId, kind: kindId, text: json.text, warnings: json.warnings ?? [] });
      setBody(json.text);
    } catch (err) {
      setToast({ ok: false, message: err instanceof Error ? err.message : "Drafting failed." });
    } finally {
      setDrafting(false);
    }
  }

  function done(res: Toast) {
    setToast(res);
    if (!res.ok) return;
    setDraft(null);
    setBody("");
    setReason("");
    setRejecting(false);
    router.refresh();
  }

  const send = () => start(async () => done(await sendDraftAction(draft!.id, clientId, body)));
  const reject = () => start(async () => done(await rejectDraftAction(draft!.id, clientId, reason)));

  const field = "w-full rounded-lg border border-line bg-abyss px-3 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-center gap-1.5">
        {kinds.map((k) => {
          const active = k.id === (draft?.kind ?? kindId);
          return (
            <button
              key={k.id}
              type="button"
              disabled={busy || Boolean(draft)}
              onClick={() => setKindId(k.id)}
              title={k.blocked}
              className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed ${
                active ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint ring-1 ring-line/60 hover:text-ink"
              } ${k.blocked && !active ? "opacity-60" : ""}`}
            >
              {k.label}
              {k.marketing && <span className="ml-1 text-ember">· mkt</span>}
            </button>
          );
        })}
      </div>

      {blockers.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-3" role="status">
          <span className="mt-0.5 shrink-0 text-warn"><Icon name="alert" size={15} /></span>
          <div className="text-sm leading-relaxed text-ink-dim">
            <p className="font-semibold text-warn">Can&apos;t send &ldquo;{selected.label}&rdquo;</p>
            {blockers.map((b) => <p key={b}>{b}</p>)}
          </div>
        </div>
      )}

      {!draft && (
        <>
          <textarea
            value={instruction}
            rows={2}
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={kindId === "custom" ? "What should the text say?" : "Optional: anything to mention or avoid"}
            className={`${field} resize-none`}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              {trainingCount} past decision{trainingCount === 1 ? "" : "s"} in memory
            </span>
            <button type="button" onClick={generate} disabled={busy} className={buttonClass("primary", "sm")}>
              <Icon name="spark" size={13} />
              {drafting ? "Drafting…" : "Draft"}
            </button>
          </div>
        </>
      )}

      {draft && (
        <div className="rounded-xl border border-line bg-abyss-2 p-3">
          <textarea
            value={body}
            rows={5}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            className={`${field} resize-y`}
          />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            {outgoing.length} chars · {count.segments} segment{count.segments === 1 ? "" : "s"}
            {count.unicode && <span className="text-warn"> · unicode, 70 per segment</span>}
            {count.segments > 2 && <span className="text-warn"> · long</span>}
            {selected.marketing && <span> · &ldquo;{optOutLine}&rdquo; added on send</span>}
          </p>
          {draft.warnings.length > 0 && (
            <p className="mt-2 text-xs text-warn">Check before sending: {draft.warnings.join("; ")}.</p>
          )}

          {rejecting && (
            <input
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional, it teaches the next draft)"
              className={`${field} mt-3`}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={generate} disabled={busy} className={buttonClass("ghost", "sm")}>
              <Icon name="refresh" size={13} />
              {drafting ? "Drafting…" : "Regenerate"}
            </button>
            {rejecting ? (
              <button type="button" onClick={reject} disabled={busy} className={buttonClass("danger", "sm")}>
                Confirm reject
              </button>
            ) : (
              <button type="button" onClick={() => setRejecting(true)} disabled={busy} className={buttonClass("outline", "sm")}>
                <Icon name="x" size={13} /> Reject
              </button>
            )}
            <button
              type="button"
              onClick={send}
              disabled={busy || !body.trim() || blockers.length > 0}
              title={blockers[0]}
              className={buttonClass("primary", "sm")}
            >
              <Icon name="send" size={13} />
              {pending ? "Working…" : body.trim() === draft.text ? "Send" : "Send edited"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {toast.message}
        </p>
      )}
    </div>
  );
}
