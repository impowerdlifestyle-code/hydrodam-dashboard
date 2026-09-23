"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { resetWordingAction, saveTimingAction, saveWordingAction } from "@/app/(app)/automations/actions";
import { OPT_OUT_LINE, TOKEN_LABELS, checkWording, describeTiming } from "@/lib/sms-wording";

type Toast = { ok: boolean; message: string } | null;

function ToastLine({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>
      {toast.message}
    </p>
  );
}

/** The text as it reads, with each field drawn as a chip instead of braces. */
function Reads({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}]+\})/g).filter(Boolean);
  return (
    <p className="text-sm leading-relaxed text-ink">
      {parts.map((p, i) =>
        /^\{[^{}]+\}$/.test(p) ? (
          <span key={i} className="mx-0.5 inline-block rounded-md bg-teal/15 px-1.5 py-px font-mono text-[11px] text-teal ring-1 ring-line-bright">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

export function WordingEditor({
  flowKey,
  initial,
  tokens,
  marketing,
  customised,
}: {
  flowKey: string;
  initial: string;
  tokens: string[];
  marketing: boolean;
  customised: boolean;
}) {
  const [text, setText] = useState(initial);
  const [toast, setToast] = useState<Toast>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const check = checkWording(text, tokens, marketing);

  function insert(label: string) {
    const el = area.current;
    const chip = `{${label}}`;
    if (!el) return setText((t) => `${t}${chip}`);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = `${text.slice(0, a)}${chip}${text.slice(b)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + chip.length, a + chip.length);
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const res = await fn();
      setToast(res);
      if (res.ok) router.refresh();
    });

  return (
    <div>
      <p className="mb-2 text-xs text-ink-dim">Tap a field to drop it in where your cursor is. We fill it in for each customer.</p>
      <div className="mb-3 flex flex-wrap justify-center gap-1.5">
        {tokens.map((t) => (
          <button
            key={t}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(TOKEN_LABELS[t])}
            className="rounded-full bg-teal/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-teal ring-1 ring-line-bright hover:bg-teal/20"
          >
            + {TOKEN_LABELS[t]}
          </button>
        ))}
      </div>

      <textarea
        ref={area}
        value={text}
        rows={4}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-y rounded-lg border border-line bg-abyss px-3 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
      />
      <div className="mt-2 rounded-lg border border-line/60 bg-white/[0.02] px-3 py-2">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">How it reads</p>
        <Reads text={text} />
      </div>

      <div className="mt-4">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Preview for a sample customer</p>
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-teal/15 px-3.5 py-2.5 ring-1 ring-line-bright">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{check.preview || "None"}</p>
          </div>
        </div>
        <p className="mt-1.5 text-right font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          {check.preview.length} characters · {check.segments} text{check.segments === 1 ? "" : "s"} long
          {marketing && <span> · &ldquo;{OPT_OUT_LINE}&rdquo; is always added</span>}
        </p>
      </div>

      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1.5 text-xs">
          {check.errors.map((e) => <li key={e} className="flex gap-2 text-bad"><Icon name="x" size={13} />{e}</li>)}
          {check.warnings.map((w) => <li key={w} className="flex gap-2 text-warn"><Icon name="alert" size={13} />{w}</li>)}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {customised && (
          <button type="button" disabled={pending} onClick={() => run(() => resetWordingAction(flowKey))} className={buttonClass("ghost", "sm")}>
            <Icon name="refresh" size={13} /> Use the built-in wording
          </button>
        )}
        <button
          type="button"
          disabled={pending || check.errors.length > 0}
          onClick={() => run(() => saveWordingAction(flowKey, text))}
          className={buttonClass("primary", "sm")}
        >
          <Icon name="check" size={13} /> {pending ? "Saving…" : "Save wording"}
        </button>
      </div>
      <ToastLine toast={toast} />
    </div>
  );
}

export function TimingEditor({
  flowKey,
  offsets,
  anchor,
  before,
  after,
}: {
  flowKey: string;
  offsets: number[];
  anchor: string;
  before: boolean;
  after: boolean;
}) {
  const [days, setDays] = useState<number[]>(offsets);
  const [amount, setAmount] = useState(1);
  const [side, setSide] = useState<"before" | "after" | "on">(after ? "after" : "before");
  const [toast, setToast] = useState<Toast>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const label = (n: number) =>
    n === 0 ? "On the day" : `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n < 0 ? "before" : "after"}`;
  const add = () => {
    const n = side === "on" ? 0 : side === "before" ? -Math.abs(amount) : Math.abs(amount);
    setDays((d) => [...new Set([...d, n])].sort((a, b) => a - b));
  };

  return (
    <div>
      <p className="mb-3 text-xs text-ink-dim">Counted from {anchor}.</p>
      <div className="mb-3 flex flex-wrap justify-center gap-1.5">
        {days.map((n) => (
          <span key={n} className="inline-flex items-center gap-1.5 rounded-full bg-teal/10 px-3 py-1 text-xs text-teal ring-1 ring-line-bright">
            {label(n)}
            <button type="button" aria-label={`Remove ${label(n)}`} onClick={() => setDays((d) => d.filter((x) => x !== n))} className="text-ink-faint hover:text-bad">
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {days.length === 0 && <span className="text-xs text-ink-faint">None</span>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        <span className="text-ink-dim">Add a send</span>
        {side !== "on" && (
          <input
            type="number"
            min={1}
            max={90}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 1)}
            className="w-16 rounded-lg border border-line bg-abyss px-2 py-1.5 text-center text-ink outline-none focus:border-teal"
          />
        )}
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as typeof side)}
          className="rounded-lg border border-line bg-abyss px-2 py-1.5 text-ink outline-none focus:border-teal"
        >
          {before && <option value="before">days before</option>}
          <option value="on">on the day</option>
          {after && <option value="after">days after</option>}
        </select>
        <button type="button" onClick={add} className={buttonClass("outline", "sm")}>
          <Icon name="plus" size={13} /> Add
        </button>
      </div>

      <p className="mt-3 text-center text-sm text-ink">{describeTiming(days, anchor)}</p>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={pending || days.length === 0}
          onClick={() => start(async () => {
            const res = await saveTimingAction(flowKey, days);
            setToast(res);
            if (res.ok) router.refresh();
          })}
          className={buttonClass("primary", "sm")}
        >
          <Icon name="check" size={13} /> {pending ? "Saving…" : "Save timing"}
        </button>
      </div>
      <ToastLine toast={toast} />
    </div>
  );
}
