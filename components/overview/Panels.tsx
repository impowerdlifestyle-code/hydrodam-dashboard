import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Avatar, AvatarStack, Bar, EmptyState, LinkButton, Money, Panel, SectionLabel, StatCard, StatusPill } from "@/components/ui";
import { ChecklistCard } from "@/components/ChecklistCard";
import { clientName, db, getStaff, metrics, propertyFor, revenueByMonth, todaysVisits, liveRequests, openTimeEntry } from "@/lib/db";
import { inboxThreads } from "@/lib/comms";
import { audienceCounts, listCampaigns } from "@/lib/campaigns";
import { listItems, type ChecklistSpec } from "@/lib/builder";
import type { PanelKey } from "@/lib/layout";
import type { Role } from "@/lib/types";
import { compactMoney, money, relative, timeRange } from "@/lib/format";

/**
 * Every Overview panel, keyed by the name the Build Agent uses. The page maps
 * a role's layout over this table, so adding a panel here is the only way one
 * becomes available to a layout.
 */

const link = (href: string, label: string) => (
  <Link href={href} className="font-mono text-[11px] uppercase tracking-wider text-teal hover:underline">{label}</Link>
);

function Stats() {
  const m = metrics();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Open pipeline" value={compactMoney(m.openPipelineCents)} sub={`${m.openQuoteCount} live quotes`} href="/quotes" />
      <StatCard label="Won this month" value={compactMoney(m.wonThisMonthCents)} sub={`${m.closeRatePct}% close rate`} accent="good" />
      <StatCard label="Outstanding" value={compactMoney(m.outstandingCents)} sub={m.overdueCount ? `${money(m.overdueCents)} overdue` : "nothing overdue"} accent={m.overdueCount ? "bad" : "teal"} href="/invoices" />
      <StatCard label="Active jobs" value={m.activeJobs} sub={`${m.visitsToday} visits today`} accent="ember" href="/jobs" />
    </div>
  );
}

function Today() {
  const today = todaysVisits();
  return (
    <Panel>
      <SectionLabel action={link("/schedule", "Full schedule")}>Today on the board</SectionLabel>
      {today.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing scheduled today" body="Book a visit from a job or a request and it lands here." action={<LinkButton href="/schedule" size="sm" variant="secondary">Open schedule</LinkButton>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {today.map((v) => {
            const prop = propertyFor(v.clientId);
            const crew = v.assignedTo.map((id) => getStaff(id));
            return (
              <li key={v.id}>
                <Link href={v.jobId ? `/jobs/${v.jobId}` : "/schedule"} className="flex items-center gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:border-line-bright">
                  <span className="w-20 shrink-0 font-mono text-[11px] tabular-nums text-teal">{timeRange(v.scheduledStart, v.scheduledEnd)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{clientName(v.clientId)}</span>
                    <span className="block truncate text-xs text-ink-dim">{v.title} · {prop?.city}</span>
                  </span>
                  <AvatarStack names={crew.map((c) => c?.name ?? "?")} colors={crew.map((c) => c?.color ?? "")} />
                  <StatusPill status={v.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Attention() {
  const d = db();
  const m = metrics();
  const today = new Date().toISOString().slice(0, 10);
  const items = [
    ...d.requests.filter((r) => r.status === "new").map((r) => ({ key: `req-${r.id}`, icon: "inbox" as const, tone: "ember" as const, title: `New request from ${clientName(r.clientId)}`, detail: `${r.source} · ${relative(r.createdAt)}`, href: `/requests/${r.id}` })),
    ...d.conversations.filter((c) => c.unreadCount > 0).map((c) => ({ key: `msg-${c.id}`, icon: "mail" as const, tone: "warn" as const, title: `${c.unreadCount} unread from ${clientName(c.clientId)}`, detail: `${c.channel.toUpperCase()} · ${relative(c.lastMessageAt)}`, href: `/inbox/${c.id}` })),
    ...d.invoices.filter((i) => ["sent", "viewed", "partially_paid"].includes(i.status) && (i.dueDate ?? "9999") < today).map((i) => ({ key: `inv-${i.id}`, icon: "dollar" as const, tone: "bad" as const, title: `Invoice #${i.number} overdue — ${money(i.totalCents - i.amountPaidCents)}`, detail: `${clientName(i.clientId)} · due ${i.dueDate}`, href: `/invoices/${i.id}` })),
    ...d.visits.filter((v) => v.status === "unscheduled").map((v) => ({ key: `vis-${v.id}`, icon: "calendar" as const, tone: "ember" as const, title: `Unscheduled: ${v.title}`, detail: clientName(v.clientId), href: "/schedule" })),
  ];
  return (
    <Panel>
      <SectionLabel>Needs you</SectionLabel>
      {items.length === 0 ? (
        <EmptyState icon="check" title="All clear" body="No new requests, unread messages or overdue invoices." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.slice(0, 7).map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/5">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.tone === "bad" ? "bg-bad/15 text-bad" : a.tone === "warn" ? "bg-warn/15 text-warn" : "bg-ember/15 text-ember"}`}>
                  <Icon name={a.icon} size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{a.title}</span>
                  <span className="block truncate text-xs text-ink-faint">{a.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {m.slowResponses > 0 && (
        <p className="mt-3 rounded-xl border border-ember/30 bg-ember/10 px-3 py-2 text-xs text-ember">
          <strong>{m.slowResponses}</strong> {m.slowResponses === 1 ? "lead" : "leads"} waited more than 5 minutes for a first reply.
        </p>
      )}
    </Panel>
  );
}

function Requests() {
  const rows = [...liveRequests()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  return (
    <Panel>
      <SectionLabel action={link("/requests", "All requests")}>Newest requests</SectionLabel>
      {rows.length === 0 ? <EmptyState icon="inbox" title="No requests yet" /> : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{clientName(r.clientId)}</span>
                  <span className="block truncate text-xs text-ink-faint">{r.source} · {relative(r.createdAt)}</span>
                </span>
                <StatusPill status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

async function Inbox() {
  const threads = (await inboxThreads()).slice(0, 6);
  return (
    <Panel>
      <SectionLabel action={link("/inbox", "Open inbox")}>Latest conversations</SectionLabel>
      {threads.length === 0 ? <EmptyState icon="mail" title="No conversations yet" /> : (
        <ul className="flex flex-col gap-1.5">
          {threads.map((t) => (
            <li key={t.conversation.id}>
              <Link href={`/inbox/${t.conversation.id}`} className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-white/5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${t.conversation.unreadCount ? "bg-ember" : "bg-line"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{t.name}</span>
                  <span className="block truncate text-xs text-ink-faint">{t.last?.body ?? t.conversation.channel}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">{relative(t.conversation.lastMessageAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Crew() {
  const d = db();
  const staff = d.staff.filter((s) => s.active && s.role === "crew");
  const today = todaysVisits();
  return (
    <Panel>
      <SectionLabel action={link("/team", "Team")}>Crew today</SectionLabel>
      {staff.length === 0 ? <EmptyState icon="users" title="No crew on the roster" /> : (
        <ul className="flex flex-col gap-2">
          {staff.map((s) => {
            const mine = today.filter((v) => v.assignedTo.includes(s.id));
            const running = openTimeEntry(s.id);
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line/60 p-2.5">
                <Avatar name={s.name} size={26} color={s.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{s.name}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {mine.length ? mine.map((v) => `${timeRange(v.scheduledStart, v.scheduledEnd)} ${clientName(v.clientId)}`).join(" · ") : "nothing assigned today"}
                  </span>
                </span>
                <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${running ? "text-warn" : "text-ink-faint"}`}>{running ? "on the clock" : "off"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function Checklists({ role }: { role: Role }) {
  const audience = role === "crew" ? "crew" : "office";
  const items = (await listItems<ChecklistSpec>("checklist")).filter((c) => c.spec.audience === audience);
  return (
    <Panel>
      <SectionLabel action={link("/builder", "Build one")}>Checklists for the {audience}</SectionLabel>
      {items.length === 0 ? (
        <EmptyState icon="clipboard" title="No checklists yet" body="Ask the Builder for one and it shows up here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => <ChecklistCard key={c.id} name={c.name} spec={c.spec} compact />)}
        </div>
      )}
    </Panel>
  );
}

function Revenue() {
  const revenue = revenueByMonth(6);
  const max = Math.max(...revenue.map((r) => Math.max(r.bookedCents, r.collectedCents)), 1);
  return (
    <Panel>
      <SectionLabel>Booked vs collected, last 6 months</SectionLabel>
      <div className="flex flex-col gap-3.5">
        {revenue.map((r) => (
          <div key={r.month} className="flex items-center gap-3">
            <span className="w-9 shrink-0 font-mono text-[11px] uppercase text-ink-faint">{r.month}</span>
            <span className="flex-1">
              <span className="mb-1 block h-2 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-teal" style={{ width: `${Math.round((r.bookedCents / max) * 100)}%` }} /></span>
              <span className="block h-2 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-good" style={{ width: `${Math.round((r.collectedCents / max) * 100)}%` }} /></span>
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink">{compactMoney(r.bookedCents)}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 flex gap-4 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teal" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" /> Collected</span>
      </p>
    </Panel>
  );
}

function Pipeline() {
  const d = db();
  const m = metrics();
  const stages = ["draft", "sent", "viewed", "approved", "converted"] as const;
  const totals = stages.map((st) => d.quotes.filter((q) => q.status === st).reduce((s, q) => s + q.totalCents, 0));
  const max = Math.max(...totals, 1);
  return (
    <Panel>
      <SectionLabel action={link("/quotes", "All quotes")}>Pipeline by stage</SectionLabel>
      <div className="flex flex-col gap-3.5">
        {stages.map((stage, i) => (
          <Bar key={stage} label={`${stage[0].toUpperCase()}${stage.slice(1)} · ${d.quotes.filter((q) => q.status === stage).length}`} value={totals[i]} max={max} hint={compactMoney(totals[i])} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Average ticket</p>
          <p className="mt-1 font-display text-lg font-bold text-ink"><Money cents={m.avgTicketCents} /></p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Collected this month</p>
          <p className="mt-1 font-display text-lg font-bold text-good">{money(m.collectedThisMonthCents)}</p>
        </div>
      </div>
    </Panel>
  );
}

async function Campaigns() {
  const [counts, past] = await Promise.all([audienceCounts(), listCampaigns()]);
  return (
    <Panel>
      <SectionLabel action={link("/campaigns", "Campaigns")}>Text campaigns</SectionLabel>
      <p className="text-sm text-ink"><strong className="font-display text-lg">{counts.all}</strong> <span className="text-ink-dim">people can be texted</span></p>
      {past.length === 0 ? <p className="mt-2 text-xs text-ink-faint">Nothing sent yet.</p> : (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {past.slice(0, 4).map((c) => (
            <li key={c.id} className="flex justify-between gap-2 text-ink-dim"><span className="truncate">{c.planned.name ?? "Untitled"}</span><span className="shrink-0 font-mono">{c.sent} sent</span></li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Panels that fill a full row on their own. Everything else pairs up. */
export const FULL_WIDTH: PanelKey[] = ["stats", "today"];

export function renderPanel(key: PanelKey, role: Role) {
  switch (key) {
    case "stats": return <Stats />;
    case "today": return <Today />;
    case "attention": return <Attention />;
    case "requests": return <Requests />;
    case "inbox": return <Inbox />;
    case "crew": return <Crew />;
    case "checklists": return <Checklists role={role} />;
    case "revenue": return <Revenue />;
    case "pipeline": return <Pipeline />;
    case "campaigns": return <Campaigns />;
  }
}
