"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { sendReplyAction } from "@/app/(app)/inbox/[id]/actions";


/** Mirrors lib/telnyx.ts so the counter matches what Telnyx will actually bill. */
function segments(text: string) {
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const per = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length === 0 ? 0 : text.length <= per ? 1 : Math.ceil(text.length / multi);
}

export function ReplyComposer({
  conversationId,
  blocked,
  firstName,
  templates = [],
}: {
  conversationId: string;
  blocked?: string;
  firstName: string;
  templates?: { key: string; name: string; body: string }[];
}) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  if (blocked) {
    return (
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] p-3">
        <span className="mt-0.5 shrink-0 text-warn"><Icon name="alert" size={15} /></span>
        <p className="text-sm leading-relaxed text-ink-dim">{blocked}</p>
      </div>
    );
  }

  const count = segments(body);

  function send() {
    startTransition(async () => {
      const res = await sendReplyAction(conversationId, body);
      setToast(res);
      if (res.ok) {
        setBody("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-5 rounded-xl border border-line bg-abyss-2 p-3">
      <textarea
        value={body}
        rows={3}
        placeholder="Write a reply…"
        disabled={pending}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
        className="w-full resize-none rounded-lg border border-line bg-abyss px-3 py-2.5 text-sm text-ink outline-none focus:border-teal disabled:opacity-60"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setBody(t.body.replace(/\{\{first_name\}\}/g, firstName))}
            className="rounded-lg border border-line/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint transition-colors hover:border-line-bright hover:text-teal"
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">
          {body.length} chars · {count} segment{count === 1 ? "" : "s"}
        </span>
        <button type="button" onClick={send} disabled={pending || !body.trim()} className={buttonClass("primary", "sm")}>
          <Icon name="send" size={13} />
          {pending ? "Sending…" : "Send SMS"}
        </button>
      </div>

      {toast && (
        <p className={`mt-2.5 rounded-lg border px-3 py-2 text-xs ${
          toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"
        }`}>
          {toast.message}
        </p>
      )}
    </div>
  );
}
