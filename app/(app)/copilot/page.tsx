"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Panel } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content: "I'm your HydroDam Copilot. I can see your live pipeline, contacts, workflows, and SOPs. Ask me to prioritize your day, summarize a deal, or draft a follow-up.",
};
const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarize my open pipeline.",
  "Draft a follow-up to the St. Pete Beach storefront deal.",
  "Which deals are at risk?",
];

export default function CopilotPage() {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "No response." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Connection issue — try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="AI Copilot" subtitle="Claude, with eyes on your CRM, calendar, workflows & SOPs." />
      <Panel className="flex h-[72vh] flex-col p-0">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start gap-3"}>
              {m.role === "assistant" && (
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/15 text-teal"><Icon name="spark" size={16} /></span>
              )}
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "bg-teal text-white" : "border border-line bg-abyss/50 text-ink-dim"}`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal/15 text-teal"><Icon name="spark" size={16} /></span>
              <div className="flex gap-1 rounded-2xl border border-line bg-abyss/50 px-4 py-3.5">
                {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" style={{ animationDelay: `${i * 150}ms` }} />)}
              </div>
            </div>
          )}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-line-bright hover:text-teal">{s}</button>
              ))}
            </div>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t border-line p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your Copilot…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-abyss-2 px-4 py-2.5 text-sm text-ink outline-none focus:border-teal"
          />
          <button type="submit" disabled={loading || !input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            <Icon name="logout" size={18} className="rotate-180" />
          </button>
        </form>
      </Panel>
    </>
  );
}
