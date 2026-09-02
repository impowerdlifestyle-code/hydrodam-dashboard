import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, SectionLabel, StatCard } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { messageTemplates } from "@/lib/builder";
import { inboxThreads } from "@/lib/comms";
import { phoneDisplay, relative } from "@/lib/format";
import { telnyxStatus } from "@/lib/telnyx";
import { ensureData } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox · HydroDam Ops" };

export default async function InboxPage() {
  await ensureData();
  const threads = await inboxThreads();
  const templates = await messageTemplates();
  const unread = threads.reduce((s, t) => s + t.conversation.unreadCount, 0);
  const outbound30 = threads.filter((t) => t.last?.direction === "outbound").length;

  const telnyx = telnyxStatus();

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Two-way SMS and email, threaded per client."
        action={
          <Badge tone={telnyx.live ? "good" : "warn"}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {telnyx.live ? `Telnyx ${phoneDisplay(telnyx.from)}` : "Telnyx not connected"}
          </Badge>
        }
      />

      {telnyx.live && !telnyx.signed && (
        <p className="mb-4 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3 text-xs leading-relaxed text-ink-dim">
          <span className="font-semibold text-warn">Inbound is off.</span> TELNYX_PUBLIC_KEY is not set, so
          the webhook refuses every delivery — replies from customers will not appear here until it is.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Unread" value={unread} accent={unread ? "ember" : "good"} />
        <StatCard label="Open threads" value={threads.filter((t) => t.conversation.status === "open").length} />
        <StatCard label="Messages sent" value={outbound30} sub="templates and automations" accent="teal" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionLabel>Conversations</SectionLabel>
          {threads.length === 0 ? (
            <EmptyState icon="mail" title="No conversations" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {threads.map(({ conversation: c, name, last }) => (
                  <li key={c.id}>
                    <Link href={`/inbox/${c.id}`} className="flex items-start gap-3 rounded-xl border border-line/60 p-3 transition-colors hover:border-line-bright">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${c.unreadCount ? "bg-ember/15 text-ember" : "bg-teal/10 text-teal"}`}>
                        <Icon name={c.channel === "sms" ? "phone" : "mail"} size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm ${c.unreadCount ? "font-bold text-ink" : "font-semibold text-ink-dim"}`}>
                            {name}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-ink-faint">{relative(c.lastMessageAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-faint">
                          {last?.direction === "outbound" && <span className="text-teal">You: </span>}
                          {last?.body ?? "—"}
                        </span>
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="mt-1 shrink-0 rounded-full bg-ember px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">{c.unreadCount}</span>
                      )}
                    </Link>
                  </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <SectionLabel>Templates</SectionLabel>
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li key={t.key} className="rounded-xl border border-line/60 p-3">
                <p className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
                  {t.name}
                  <span className="flex gap-1">{t.custom && <Badge tone="good">built here</Badge>}<Badge tone={t.channel === "sms" ? "teal" : "neutral"}>{t.channel}</Badge></span>
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{t.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
