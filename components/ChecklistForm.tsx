"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { QA_CHECKLIST, allFields } from "@/lib/forms";
import { saveChecklistAction } from "@/app/field/visit/[id]/checklist/actions";

/**
 * Ported from the marketing site's crew checklist. The two things that made it
 * work in the field are kept exactly: a sticky required-count progress bar, and
 * a submit button that says what it will do — "Save progress (n/m)" until every
 * required check is done, then "Sign off this installation".
 *
 * Answers are keyed by field.id, never by label. Rewording a question must not
 * orphan past submissions.
 */
export function ChecklistForm({
  visitId,
  initial,
  submitted,
}: {
  visitId: string;
  initial: Record<string, string>;
  submitted: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  const required = useMemo(() => allFields(QA_CHECKLIST).filter((f) => f.required), []);
  const done = required.filter((f) => (answers[f.id] ?? "").trim()).length;
  const complete = done === required.length;

  function set(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  function save(submit: boolean) {
    startTransition(async () => {
      const res = await saveChecklistAction(visitId, answers, submit);
      setToast(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="pb-28">
      {QA_CHECKLIST.map((group) => (
        <section key={group.title} className="panel mt-4 rounded-2xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-teal">{group.title}</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {group.fields.map((f) => {
              const value = answers[f.id] ?? "";
              if (f.type === "check") {
                const on = value === "Pass";
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={submitted}
                    onClick={() => set(f.id, on ? "" : "Pass")}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                      on ? "border-good/40 bg-good/8" : "border-line hover:border-line-bright"
                    }`}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      on ? "border-good bg-good/20 text-good" : "border-line text-transparent"
                    }`}>
                      <Icon name="check" size={12} />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm ${on ? "text-ink" : "text-ink-dim"}`}>
                        {f.label}
                        {f.required && !on && <span className="ml-1 text-ember">*</span>}
                      </span>
                      {f.help && <span className="mt-0.5 block text-xs text-ink-faint">{f.help}</span>}
                    </span>
                  </button>
                );
              }
              return (
                <label key={f.id} className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {f.label}
                    {f.required && <span className="ml-1 text-ember">*</span>}
                  </span>
                  {f.type === "select" ? (
                    <select
                      value={value}
                      disabled={submitted}
                      onChange={(e) => set(f.id, e.target.value)}
                      className="w-full rounded-xl border border-line bg-abyss-2 px-4 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
                    >
                      <option value="">Choose…</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      value={value}
                      rows={3}
                      disabled={submitted}
                      onChange={(e) => set(f.id, e.target.value)}
                      className="w-full rounded-xl border border-line bg-abyss-2 px-4 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
                    />
                  ) : (
                    <input
                      value={value}
                      disabled={submitted}
                      onChange={(e) => set(f.id, e.target.value)}
                      className="w-full rounded-xl border border-line bg-abyss-2 px-4 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
                    />
                  )}
                  {f.help && <span className="mt-1 block text-xs text-ink-faint">{f.help}</span>}
                </label>
              );
            })}
          </div>
        </section>
      ))}

      {toast && (
        <p className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${
          toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"
        }`}>
          {toast.message}
        </p>
      )}

      {/* sticky action bar — the thing that made the paper version work */}
      <div className="fixed inset-x-0 bottom-[62px] mx-auto max-w-lg border-t border-line bg-abyss-2/95 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
            <span
              className={`block h-full rounded-full transition-all ${complete ? "bg-good" : "bg-warn"}`}
              style={{ width: `${(done / required.length) * 100}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">{done}/{required.length}</span>
        </div>
        {submitted ? (
          <p className="rounded-xl border border-good/40 bg-good/10 py-3 text-center text-sm font-semibold text-good">
            Signed off
          </p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(complete)}
            className={`w-full rounded-xl py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${
              complete ? "bg-good" : "bg-teal"
            }`}
          >
            {pending ? "Saving…" : complete ? "Sign off this installation" : `Save progress (${done}/${required.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
