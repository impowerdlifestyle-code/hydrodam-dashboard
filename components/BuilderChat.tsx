"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";

type Change = { kind: string; key: string; name: string; action: "created" | "updated" | "removed" | "filed"; href?: string };
type Msg = { role: "user" | "assistant"; content: string; changes?: Change[] };

const GREETING: Msg = {
  role: "assistant",
  content: "Tell me what you wish the dashboard did. I can build message templates, timed automations, checklists and the Overview layout for each role right now. Anything that needs real code I write up and send to Voreli.",
};

const SUGGESTIONS = [
  "Text customers 2 days after an install to ask how the barriers fit.",
  "Give the crew a morning checklist: truck stocked, planks counted, photos before and after.",
  "Show the office team requests and the inbox first on the Overview.",
  "Add a template for when a homeowner asks about financing.",
];

const ACTION_TONE: Record<Change["action"], string> = {
  created: "border-good/40 bg-good/10 text-good",
  updated: "border-teal/40 bg-teal/10 text-teal",
  removed: "border-warn/40 bg-warn/10 text-warn",
  filed: "border-ember/40 bg-ember/10 text-ember",
};

export function BuilderChat() {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || loading) return;
    const next = [...messages, { role: "user" as const, content: t }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json()) as { reply?: string; changes?: Change[] };
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "No response.", changes: data.changes }]);
      if (data.changes?.length) router.refresh();
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Connection issue. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[70vh] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start gap-3"}>
            {m.role === "assistant" && (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember/15 text-ember"><Icon name="settings" size={16} /></span>
            )}
            <div className={`max-w-[85%] ${m.role === "user" ? "rounded-2xl rounded-br-md bg-teal/15 px-4 py-2.5 text-sm text-ink" : "text-sm leading-relaxed text-ink"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.changes && m.changes.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {m.changes.map((c, j) => (
                    <li key={j}>
                      {c.href ? (
                        <Link href={c.href} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${ACTION_TONE[c.action]}`}>
                          {c.action} {c.kind.replace("_", " ")}: {c.name} <Icon name="external" size={10} />
                        </Link>
                      ) : (
                        <span className={`inline-flex rounded-lg border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${ACTION_TONE[c.action]}`}>
                          {c.action} {c.kind.replace("_", " ")}: {c.name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ember/15 text-ember"><Icon name="settings" size={16} /></span>
            Building…
          </div>
        )}
      </div>

      {messages.length === 1 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-line/60 px-2.5 py-1.5 text-left text-xs text-ink-dim transition-colors hover:border-line-bright hover:text-teal">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-line p-3">
        <textarea
          value={input}
          rows={2}
          disabled={loading}
          placeholder="Describe what you want the dashboard to do…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(input); }}
          className="w-full resize-none rounded-lg border border-line bg-abyss px-3 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
        />
        <button type="button" onClick={() => send(input)} disabled={loading || !input.trim()} className={buttonClass("primary", "sm")}>
          <Icon name="send" size={13} /> Build
        </button>
      </div>
    </div>
  );
}
