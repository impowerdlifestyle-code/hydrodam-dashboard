import { dateTime } from "@/lib/format";
import type { Message } from "@/lib/types";

/** A conversation as the Inbox renders it: ours on the right, theirs on the left. */
export function SmsThread({ messages }: { messages: Message[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {messages.map((m) => {
        const out = m.direction === "outbound";
        return (
          <li key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${out ? "bg-teal/15 ring-1 ring-line-bright" : "bg-white/5"}`}>
              <p className="text-sm leading-relaxed text-ink">{m.body}</p>
              <p className="mt-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                {dateTime(m.createdAt)}
                {m.templateKey && <span className="text-teal">· {m.templateKey.replace(/_/g, " ")}</span>}
                {out && m.deliveryStatus && (
                  <span className={m.deliveryStatus === "failed" ? "text-bad" : m.deliveryStatus === "delivered" ? "text-good" : "text-ink-faint"}>
                    · {m.deliveryError ?? m.deliveryStatus}
                  </span>
                )}
                {!m.read && !out && <span className="text-ember">· unread</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
