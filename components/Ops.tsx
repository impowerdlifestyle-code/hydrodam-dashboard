"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { runOps, type OpsInput, type OpsResult } from "@/app/(app)/actions";

/**
 * The controls that actually change something.
 *
 * Every one of them ends in the same place — `runOps` — so the feedback is the
 * same everywhere: the control disables while the write is in flight, then the
 * database's own answer appears next to it. The database is the thing that
 * refuses an illegal status move or a double-booked installer, so its message
 * is the honest one to show; nothing here second-guesses it by hiding buttons
 * that might work.
 */

type Feedback = OpsResult | null;

const FeedbackContext = createContext<{
  feedback: Feedback;
  run: (input: OpsInput) => void;
  pending: boolean;
} | null>(null);

export function useOps() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (input: OpsInput) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await runOps(input);
      setFeedback(res);
      if (res.href) router.push(res.href);
      else router.refresh();
    });
  };

  return { feedback, run, pending };
}

export function OpsToast({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const tone = feedback.ok ? "text-good border-good/30 bg-good/[0.06]" : "text-bad border-bad/30 bg-bad/[0.06]";
  return (
    <div className="mt-3">
      <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${tone}`}>
        <span className="mt-px shrink-0">
          <Icon name={feedback.ok ? "check" : "alert"} size={13} />
        </span>
        {feedback.message}
      </p>
      {feedback.reveal && <RevealOnce value={feedback.reveal} />}
    </div>
  );
}

/** A secret the server will not hand over twice. Select-all on click. */
function RevealOnce({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink"
      />
      <button
        type="button"
        className={buttonClass("outline", "sm")}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A single button bound to one write. */
export function OpsButton({
  input,
  children,
  variant = "outline",
  size = "sm",
  full = false,
  confirm,
  icon,
}: {
  input: OpsInput;
  children: ReactNode;
  variant?: "primary" | "outline" | "danger" | "ember" | "ghost";
  size?: "sm" | "md" | "lg";
  full?: boolean;
  confirm?: string;
  icon?: Parameters<typeof Icon>[0]["name"];
}) {
  const shared = useContext(FeedbackContext);
  const own = useOps();
  const { run, pending } = shared ?? own;
  const [armed, setArmed] = useState(false);

  const label = confirm && armed ? confirm : children;

  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={buttonClass(confirm && armed ? "danger" : variant, size, full)}
        onClick={() => {
          if (confirm && !armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          run(input);
        }}
      >
        {icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />}
        {pending ? "Working…" : label}
      </button>
      {!shared && <OpsToast feedback={own.feedback} />}
    </>
  );
}

/**
 * A select that writes on change.
 *
 * `field` names the key of `input` the chosen value fills, because a function
 * cannot cross the server/client boundary as a prop and a template object can.
 */
export function OpsSelect<K extends string>({
  input,
  field,
  value,
  options,
  label,
}: {
  input: Record<string, unknown> & { kind: OpsInput["kind"] };
  field: K;
  value: string;
  options: { value: string; label: string }[];
  label?: string;
}) {
  const shared = useContext(FeedbackContext);
  const own = useOps();
  const { run, pending } = shared ?? own;

  return (
    <div>
      {label && <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>}
      <select
        disabled={pending}
        value={value}
        onChange={(e) => run({ ...input, [field]: e.target.value } as unknown as OpsInput)}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-teal disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!shared && <OpsToast feedback={own.feedback} />}
    </div>
  );
}

/** Groups several controls so they share one pending state and one message. */
export function OpsGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ops = useOps();
  return (
    <FeedbackContext.Provider value={ops}>
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        <OpsToast feedback={ops.feedback} />
      </div>
    </FeedbackContext.Provider>
  );
}

export { FeedbackContext };
