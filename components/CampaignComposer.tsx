"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { planCampaignAction, sendCampaignAction } from "@/app/(app)/campaigns/actions";
import type { Plan } from "@/lib/campaigns";

const STARTERS = [
  { name: "Storm watch", body: "HydroDam storm watch: put your barriers up now, not the night before. Need a hand deploying? Call (727) 613-1415." },
  { name: "Season check", body: "Hi {{first_name}}, HydroDam here. Hurricane season is on. Want us to check your openings before the first storm? Reply YES and we'll book it." },
  { name: "Referral", body: "Hi {{first_name}}, thanks for trusting HydroDam. Know a neighbour who floods? Send them our way and we'll take care of them." },
];

/** Mirrors lib/telnyx.ts so the counter matches what Telnyx bills. */
function segments(text: string) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const per = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length === 0 ? 0 : text.length <= per ? 1 : Math.ceil(text.length / multi);
}

const REASON: Record<string, string> = {
  opted_out: "texted STOP",
  no_phone: "no mobile number",
  cap_reached: "over the per-send cap",
};

export function CampaignComposer({
  audiences,
  blocked,
  quiet,
}: {
  audiences: { key: string; label: string; count: number }[];
  blocked?: string;
  quiet: boolean;
}) {
  const [name, setName] = useState("");
  const [audience, setAudience] = useState(audiences[0]?.key ?? "all");
  const [body, setBody] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const count = segments(body);
  const edit = (next: string) => { setBody(next); setPlan(null); setToast(null); };

  function preview() {
    startTransition(async () => {
      const res = await planCampaignAction(audience, body);
      if ("recipients" in res) setPlan(res);
      else setToast({ ok: false, message: res.blocked });
    });
  }

  function send() {
    startTransition(async () => {
      const res = await sendCampaignAction(name, audience, body);
      setToast(res);
      if (res.ok) {
        setBody(""); setName(""); setPlan(null);
        router.refresh();
      }
    });
  }

  const input = "w-full rounded-lg border border-line bg-abyss px-3 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60";

  return (
    <div className="rounded-xl border border-line bg-abyss-2 p-4">
      {blocked && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-3">
          <span className="mt-0.5 shrink-0 text-warn"><Icon name="alert" size={15} /></span>
          <p className="text-sm leading-relaxed text-ink-dim">{blocked}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Campaign name</span>
          <input value={name} disabled={pending} placeholder="e.g. Sept storm watch" onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Audience</span>
          <select value={audience} disabled={pending} onChange={(e) => { setAudience(e.target.value); setPlan(null); }} className={input}>
            {audiences.map((a) => (
              <option key={a.key} value={a.key}>{a.label} ({a.count})</option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        value={body}
        rows={4}
        disabled={pending}
        placeholder="Write the text. {{first_name}} fills in each person's name."
        onChange={(e) => edit(e.target.value)}
        className={`mt-3 resize-none ${input}`}
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {STARTERS.map((t) => (
          <button
            key={t.name}
            type="button"
            disabled={pending}
            onClick={() => edit(t.body)}
            className="rounded-lg border border-line/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint transition-colors hover:border-line-bright hover:text-teal"
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          {body.length} chars · {count} segment{count === 1 ? "" : "s"} · "Reply STOP to opt out" is added if missing
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={preview} disabled={pending || !body.trim() || Boolean(blocked)} className={buttonClass("outline", "sm")}>
            <Icon name="eye" size={13} />
            {pending && !plan ? "Checking…" : "Preview recipients"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={pending || !plan || plan.recipients.length === 0 || !name.trim() || quiet || Boolean(blocked)}
            className={buttonClass("primary", "sm")}
          >
            <Icon name="send" size={13} />
            {pending && plan ? "Sending…" : plan ? `Send to ${plan.recipients.length}` : "Send"}
          </button>
        </div>
      </div>

      {quiet && (
        <p className="mt-2 text-xs text-warn">Quiet hours. Texts go out between 8am and 9pm Eastern only. You can still preview.</p>
      )}

      {plan && (
        <div className="mt-4 rounded-lg border border-line bg-abyss p-3">
          <p className="text-xs text-ink-dim">
            <strong className="text-ink">{plan.recipients.length}</strong> will receive it, {plan.segments} segment{plan.segments === 1 ? "" : "s"} each.
            {Object.entries(plan.skipped).map(([k, n]) => (
              <span key={k} className="ml-2 text-ink-faint">{n} skipped, {REASON[k] ?? k}.</span>
            ))}
          </p>
          {plan.recipients[0] && (
            <p className="mt-2 rounded-md border border-line/60 px-3 py-2 text-sm text-ink">{plan.recipients[0].text}</p>
          )}
          <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-ink-dim">
            {plan.recipients.map((r) => (
              <li key={r.id} className="flex justify-between py-0.5">
                <span>{r.name}</span>
                <span className="font-mono text-ink-faint">{r.phone}</span>
              </li>
            ))}
          </ul>
          {!name.trim() && plan.recipients.length > 0 && (
            <p className="mt-2 text-xs text-warn">Name the campaign to enable Send.</p>
          )}
        </div>
      )}

      {toast && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {toast.message}
        </p>
      )}
    </div>
  );
}
