import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCrmSummary, fmtUSD } from "@/lib/hubspot";
import { SOPS, WORKFLOWS } from "@/lib/data";

export const runtime = "nodejs";
export const maxDuration = 30;

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  let messages: Msg[] = [];
  try {
    ({ messages } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const crm = await getCrmSummary();
  const context = [
    `LIVE CRM SNAPSHOT (${crm.connected ? "HubSpot" : "demo data"}):`,
    `Open pipeline: ${fmtUSD(crm.metrics.openValue)} across ${crm.metrics.openDeals} deals. Won recently: ${fmtUSD(crm.metrics.wonValue)}. Close rate: ${crm.metrics.closeRate}%. New contacts (30d): ${crm.metrics.newContacts30d}.`,
    `Open deals: ${crm.deals.map((d) => `${d.name} — ${d.stage} — ${fmtUSD(d.amount)} (close ${d.closeDate ?? "n/a"})`).join("; ")}.`,
    `Recent contacts: ${crm.contacts.map((c) => `${c.name} (${c.stage ?? "lead"})`).join(", ")}.`,
    `Active workflows: ${WORKFLOWS.filter((w) => w.status === "live").map((w) => w.name).join(", ")}.`,
    `SOP topics: ${SOPS.map((s) => s.title).join(", ")}.`,
  ].join("\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      reply:
        `Here's where things stand: ${fmtUSD(crm.metrics.openValue)} in open pipeline across ${crm.metrics.openDeals} deals, with a ${crm.metrics.closeRate}% close rate. ` +
        `Your biggest open deal is ${crm.deals.filter((d) => !/won|lost/i.test(d.stage)).sort((a, b) => b.amount - a.amount)[0]?.name ?? "—"}. ` +
        `(Add ANTHROPIC_API_KEY to unlock full AI answers, drafting, and analysis.)`,
    });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: `You are the AI Copilot inside HydroDam Ops — the command center for HydroDam, an aluminum flood-barrier company in St. Petersburg, FL. You help the CEO and team run the business: analyze the pipeline, prioritize the day, draft emails/SMS, summarize deals, and answer questions about CRM, calendar, workflows, and SOPs. Be concise, specific, and action-oriented. Use the live CRM snapshot below. When drafting messages, keep them warm and professional. Never invent specific prices beyond what's in the data. No markdown headers.\n\n${context}`,
      messages: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    });
    const text = msg.content.find((c) => c.type === "text");
    return NextResponse.json({ reply: text && "text" in text ? text.text : "Sorry, I couldn't generate a response." });
  } catch {
    return NextResponse.json({ reply: "I'm having trouble reaching the AI service. Try again in a moment." });
  }
}
