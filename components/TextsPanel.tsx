import Link from "next/link";
import { Badge, EmptyState, Panel, SectionLabel } from "@/components/ui";
import { SmsCopilot } from "@/components/SmsCopilot";
import { SmsThread } from "@/components/SmsThread";
import { OPT_OUT, inQuietHours, sendBlocker } from "@/lib/campaigns";
import { conversationIdForPhone, messagesIn } from "@/lib/comms";
import { relative } from "@/lib/format";
import { SMS_KINDS, draftsFor, kindGates, kindOf, suggestedKind, trainingCount } from "@/lib/sms-copilot";
import type { Client } from "@/lib/types";

const ACTION_TONE = { pending: "neutral", sent_as_is: "good", sent_edited: "teal", rejected: "bad" } as const;

/**
 * The SMS thread and the copilot beside it, for one client. Rendered on
 * /texts/[clientId] and embedded on the client page, so both read the same
 * thread and the same gates.
 */
export async function TextsPanel({ client }: { client: Client }) {
  const conversationId = client.phone ? await conversationIdForPhone(client.phone) : undefined;
  const thread = conversationId ? await messagesIn(conversationId) : [];
  const hasInbound = thread.some((m) => m.direction === "inbound");
  const [drafts, examples] = await Promise.all([draftsFor(client.id), trainingCount()]);

  const gates = kindGates(client);
  const kinds = SMS_KINDS.filter((k) => k.id !== "reply_to_latest" || hasInbound).map((k) => ({
    id: k.id,
    label: k.label,
    marketing: k.marketing,
    blocked: gates[k.id],
  }));
  const suggested = suggestedKind(client, thread);
  const defaultKind = kinds.find((k) => k.id === suggested)?.id ?? kinds[0].id;
  const blocker = sendBlocker() ?? (inQuietHours() ? "Outside quiet hours (8am to 9pm Eastern). Draft now, send in the morning." : undefined);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <SectionLabel
          action={conversationId ? (
            <Link href={`/inbox/${conversationId}`} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">
              Inbox
            </Link>
          ) : undefined}
        >
          SMS thread
        </SectionLabel>
        {thread.length ? (
          <SmsThread messages={thread.slice(-30)} />
        ) : (
          <EmptyState icon="phone" title="No texts yet" body="Nothing has been sent to or received from this number." />
        )}
      </Panel>

      <div className="flex flex-col gap-6">
        <Panel>
          <SectionLabel>Copilot</SectionLabel>
          {client.phone ? (
            <SmsCopilot
              clientId={client.id}
              kinds={kinds}
              defaultKind={defaultKind}
              sendBlocker={blocker}
              optOutLine={OPT_OUT}
              trainingCount={examples}
            />
          ) : (
            <p className="text-sm text-ink-dim">No mobile number on this client.</p>
          )}
        </Panel>

        {drafts.length > 0 && (
          <Panel>
            <SectionLabel>Recent drafts</SectionLabel>
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => (
                <li key={d.id} className="rounded-xl border border-line/70 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {kindOf(d.kind)?.label ?? d.kind} · {relative(d.createdAt)}{d.createdBy ? ` · ${d.createdBy}` : ""}
                    </span>
                    <Badge tone={ACTION_TONE[d.action]}>{d.action.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-ink-dim">{d.finalText ?? d.draftText}</p>
                  {d.rejectReason && <p className="mt-1 text-xs text-bad">Why: {d.rejectReason}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
