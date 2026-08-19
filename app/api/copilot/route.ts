import Anthropic from "@anthropic-ai/sdk";
import {
  arAging, clientName, db, ensureData, jobCosting, liveRequests, metrics, sourcePerformance,
  todaysVisits,
} from "@/lib/db";
import { requireSession } from "@/lib/session";
import { money, shortDate, timeRange } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 30;

type Msg = { role: "user" | "assistant"; content: string };

/** The operating picture the model answers from. */
function context(): string {
  const d = db();
  const m = metrics();
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`Today is ${today}. Data source: ${process.env.SUPABASE_URL ? "live Postgres" : "seeded demo data"}.`);
  lines.push(
    `METRICS — open pipeline ${money(m.openPipelineCents)} across ${m.openQuoteCount} quotes; ` +
    `won this month ${money(m.wonThisMonthCents)}; close rate ${m.closeRatePct}%; ` +
    `average ticket ${money(m.avgTicketCents)}; outstanding ${money(m.outstandingCents)} ` +
    `(${money(m.overdueCents)} overdue across ${m.overdueCount}); active jobs ${m.activeJobs}; ` +
    `${m.unassignedRequests} unworked requests; ${m.unreadMessages} unread messages.`
  );

  lines.push(
    "TODAY: " + (todaysVisits().map((v) =>
      `${timeRange(v.scheduledStart, v.scheduledEnd)} ${clientName(v.clientId)} (${v.kind}, ${v.status})`
    ).join("; ") || "nothing scheduled")
  );

  // The lead list is ~3,000 rows. Pasting all of them would blow the context
  // window, cost real money per question and bury the handful of records that
  // actually need a decision. Open work goes in full; the rest is a count.
  const requests = liveRequests().filter((r) => !["converted", "unqualified"].includes(r.status));
  lines.push(
    `REQUESTS (${requests.length} open of ${liveRequests().length}): ` +
    requests.slice(0, 40).map((r) =>
      `#${r.number} ${clientName(r.clientId)} — ${r.status}, ${r.source}${r.firstResponseAt ? "" : ", NO REPLY YET"}`
    ).join("; ")
  );

  lines.push(
    "QUOTES: " + d.quotes.slice(0, 60).map((q) =>
      `#${q.number} ${clientName(q.clientId)} ${money(q.totalCents)} ${q.primarySeries} — ${q.status}, valid to ${q.validUntil}`
    ).join("; ")
  );

  lines.push(
    "JOBS: " + d.jobs.slice(0, 60).map((j) => {
      const c = jobCosting(j.id);
      return `#${j.number} ${clientName(j.clientId)} ${money(j.contractCents)} — ${j.status}, fabrication ${j.fabricationStatus}, margin ${(c.marginBps / 100).toFixed(0)}%`;
    }).join("; ")
  );

  lines.push(
    "INVOICES: " + d.invoices.filter((i) => i.status !== "void").slice(0, 60).map((i) =>
      `#${i.number} ${clientName(i.clientId)} ${money(i.totalCents)} ${i.status}, balance ${money(i.totalCents - i.amountPaidCents)}, due ${shortDate(i.dueDate)}`
    ).join("; ")
  );

  lines.push("AR AGING: " + arAging().map((a) => `${a.bucket} ${money(a.cents)} (${a.count})`).join("; "));
  lines.push("LEAD SOURCES: " + sourcePerformance().map((s) => `${s.source} ${s.leads} leads, ${money(s.wonCents)} won`).join("; "));

  lines.push(
    "AUTOMATIONS: " + d.automations.map((a) =>
      `${a.name} — ${a.armed ? "armed" : "DRY RUN"}, ${a.sentLast30d} sent in 30d`
    ).join("; ")
  );

  const consented = d.clients.filter((c) => c.smsConsent);
  lines.push(
    `CONSENT: ${consented.length} of ${d.clients.length} clients have consented to marketing SMS` +
    (consented.length ? `: ${consented.slice(0, 30).map((c) => c.name).join(", ")}.` : ". Nobody else may be texted marketing.")
  );

  return lines.join("\n");
}

const SYSTEM = `You are the Copilot inside HydroDam Ops, the operating system for HydroDam — an aluminum flood-barrier contractor in Clearwater, Florida. Jobs run $2,900 to $90,000 and are sold by opening: each door, garage or slider gets a width, a protection height and a plank count, in one of three series (Sentinel, Onyx, and Titanium which is quote-only and never auto-priced).

You help the owner and office staff run the day: triage requests, chase quotes, protect margin, spot invoices going stale, and prioritise. Be concise, specific and numerate — lead with the number, then the action. Never invent a price, a client or a date that isn't in the snapshot; if something isn't there, say so. Never suggest texting a client who hasn't consented to marketing SMS. No markdown headers.`;

function fallback(): string {
  const m = metrics();
  const d = db();
  const biggest = [...d.quotes]
    .filter((q) => ["sent", "viewed"].includes(q.status))
    .sort((a, b) => b.totalCents - a.totalCents)[0];
  return (
    `Open pipeline is ${money(m.openPipelineCents)} across ${m.openQuoteCount} quotes, close rate ${m.closeRatePct}%. ` +
    `${m.overdueCount} invoice${m.overdueCount === 1 ? "" : "s"} overdue for ${money(m.overdueCents)}. ` +
    (biggest ? `Biggest live quote: #${biggest.number}, ${clientName(biggest.clientId)}, ${money(biggest.totalCents)}. ` : "") +
    `${m.unassignedRequests} request${m.unassignedRequests === 1 ? "" : "s"} still unworked.\n\n` +
    `(Add ANTHROPIC_API_KEY to unlock full AI answers.)`
  );
}

export async function POST(req: Request) {
  try {
    // The copilot reads the whole operating picture, so it is as sensitive as
    // any screen. The proxy matcher covers /api/copilot today; this does not
    // depend on that staying true.
    await requireSession();
    await ensureData();

    const { messages } = (await req.json()) as { messages: Msg[] };
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return Response.json({ reply: fallback() });

    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      system: `${SYSTEM}\n\nCURRENT SNAPSHOT\n${context()}`,
      messages: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    });

    const reply = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return Response.json({ reply: reply || fallback() });
  } catch {
    return Response.json({ reply: fallback() });
  }
}
