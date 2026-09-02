import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/session";
import { db, ensureData } from "@/lib/db";
import { currentStaff } from "@/lib/whoami";
import {
  TRIGGERS, createAutomation, fileBuildRequest, listItems, messageTemplates, removeItem, setLayout, upsertItem,
  type AutomationSpec, type ChecklistSpec, type Kind, type TemplateSpec,
} from "@/lib/builder";
import { PANELS, DEFAULT_LAYOUTS } from "@/lib/layout";
import { TOKENS } from "@/lib/templates";
import { NAV } from "@/lib/data";

export const runtime = "nodejs";
export const maxDuration = 90;

type Msg = { role: "user" | "assistant"; content: string };
export type Change = { kind: string; key: string; name: string; action: "created" | "updated" | "removed" | "filed"; href?: string };

const SYSTEM = `You are the Build Agent inside HydroDam Ops, the operating dashboard for HydroDam, an aluminum flood-barrier contractor in Clearwater, Florida. The office team and crew talk to you in plain English about what they wish the dashboard did, and you build it.

You can build four things directly, with no developer involved:
1. Message templates: reusable texts or emails the team picks from in the Inbox.
2. Automations: timed messages sent by the daily 9am Eastern sweep. They are created DISARMED; a human arms them on the Automations page after reading the dry run. Never claim one is live.
3. Checklists: step lists for the office or the crew, shown on the Overview and the Team page.
4. Overview layouts: which panels each role (owner, office, crew) sees, and in what order.

Anything else (a new screen, a new field, a new integration, a change to how pricing or quotes work) is a code change. For those, write a clear build request with file_build_request: what they want, why, and what done looks like. It is emailed to Voreli AI, the developer, and logged here. Tell the person it was filed and that Voreli will follow up.

Rules:
- Ask at most one clarifying question, and only when you truly cannot proceed. Prefer building a sensible version and saying what you assumed.
- Messages must sound like a small local business, not a robot: short, warm, specific. Marketing texts must end with "Reply STOP to opt out."
- Tokens you may use inside message text: ${TOKENS.map((t) => `{{${t}}}`).join(", ")}. Only use tokens the trigger can fill (quote tokens for quote.sent, invoice tokens for invoice.sent, visit tokens for visit.scheduled).
- Keys are short snake_case identifiers you choose, e.g. quote_nudge_day10.
- After building, summarise what exists now in two or three plain sentences, no markdown headers, and tell them where to find it.
- Never invent clients, numbers or results. Never arm anything.`;

const tools: Anthropic.Tool[] = [
  {
    name: "get_dashboard_state",
    description: "What exists right now: screens, automations, templates, checklists, layouts, staff roles, and recent build requests. Call this first when the request touches something that might already exist.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_message_template",
    description: "Create or replace a reusable message template the team can pick in the Inbox.",
    input_schema: {
      type: "object",
      required: ["key", "name", "channel", "body"],
      properties: {
        key: { type: "string" }, name: { type: "string" },
        channel: { type: "string", enum: ["sms", "email"] },
        body: { type: "string", description: "The message. Tokens allowed." },
        subject: { type: "string", description: "Email only." },
      },
    },
  },
  {
    name: "create_automation",
    description: `Create a timed automation (disarmed). Triggers: ${Object.entries(TRIGGERS).map(([k, v]) => `${k} = ${v}`).join("; ")}.`,
    input_schema: {
      type: "object",
      required: ["key", "name", "trigger", "offsets_days", "channels"],
      properties: {
        key: { type: "string" }, name: { type: "string" },
        trigger: { type: "string", enum: Object.keys(TRIGGERS) },
        offsets_days: { type: "array", items: { type: "integer" }, description: "Days from the anchor date on which to send, e.g. [3, 7, 14] or [-1]." },
        channels: { type: "array", items: { type: "string", enum: ["sms", "email"] }, description: "Email is tried first when the client has an email address." },
        requires_consent: { type: "string", enum: ["sms_marketing", "email_marketing"], description: "Set for anything promotional. Leave unset for messages about a booked job, quote or invoice." },
        max_sends_per_run: { type: "integer", description: "Cap per daily run. Default 25." },
        sms: { type: "string", description: "Text body, required if channels includes sms." },
        email_subject: { type: "string" }, email_body: { type: "string", description: "Plain text, blank line between paragraphs." },
      },
    },
  },
  {
    name: "create_checklist",
    description: "Create or replace a checklist or SOP for the office or the crew.",
    input_schema: {
      type: "object",
      required: ["key", "name", "audience", "steps"],
      properties: {
        key: { type: "string" }, name: { type: "string" },
        audience: { type: "string", enum: ["office", "crew"] },
        intro: { type: "string" },
        steps: { type: "array", items: { type: "object", required: ["label"], properties: { label: { type: "string" }, help: { type: "string" }, required: { type: "boolean" } } } },
      },
    },
  },
  {
    name: "set_overview_layout",
    description: `Set which panels a role sees on the Overview and in what order. Panels: ${Object.entries(PANELS).map(([k, v]) => `${k} (${v})`).join("; ")}.`,
    input_schema: {
      type: "object",
      required: ["role", "panels"],
      properties: {
        role: { type: "string", enum: ["owner", "office", "crew"] },
        panels: { type: "array", items: { type: "string", enum: Object.keys(PANELS) } },
      },
    },
  },
  {
    name: "remove_item",
    description: "Remove something that was built here: a template, automation, checklist or layout (layout reverts to the default).",
    input_schema: {
      type: "object", required: ["kind", "key"],
      properties: { kind: { type: "string", enum: ["template", "automation", "checklist", "layout"] }, key: { type: "string" } },
    },
  },
  {
    name: "file_build_request",
    description: "File a request for a change that needs code. It is emailed to the developer and logged on the Builder page.",
    input_schema: {
      type: "object", required: ["title", "summary", "details"],
      properties: {
        title: { type: "string" },
        summary: { type: "string", description: "One sentence: what and why." },
        details: { type: "string", description: "What done looks like, where it lives in the dashboard, who uses it, anything the person said that matters." },
        priority: { type: "string", enum: ["low", "normal", "high"] },
      },
    },
  },
];

async function state(): Promise<string> {
  await ensureData();
  const d = db();
  const [items, templates] = await Promise.all([listItems(), messageTemplates()]);
  const by = (k: Kind) => items.filter((i) => i.kind === k);
  return [
    `SCREENS: ${NAV.map((n) => `${n.label} (${n.href})`).join(", ")}, plus Field app (/field) and the client portal.`,
    `AUTOMATIONS: ${d.automations.map((a) => `${a.id} "${a.name}" trigger=${a.trigger} offsets=[${a.offsetsDays.join(",")}] channels=${a.channels.join("+")} ${a.armed ? "ARMED" : "disarmed"}`).join("; ")}`,
    `TEMPLATES: ${templates.map((t) => `${t.key} (${t.channel}${t.custom ? ", built here" : ""})`).join(", ")}`,
    `CHECKLISTS: ${by("checklist").map((c) => `${c.key} "${c.name}" for ${(c.spec as ChecklistSpec).audience}`).join("; ") || "none built yet"}`,
    `LAYOUTS: ${(["owner", "office", "crew"] as const).map((r) => { const l = by("layout").find((i) => i.key === r); return `${r}: ${(l ? (l.spec as { panels: string[] }).panels : DEFAULT_LAYOUTS[r]).join(" > ")}${l ? "" : " (default)"}`; }).join("; ")}`,
    `STAFF: ${d.staff.filter((s) => s.active).map((s) => `${s.name} (${s.role})`).join(", ")}`,
    `BUILD REQUESTS: ${by("build_request").slice(0, 8).map((b) => `"${b.name}" ${b.status}`).join("; ") || "none"}`,
  ].join("\n");
}

async function runTool(name: string, input: Record<string, unknown>, who: string | undefined, changes: Change[]): Promise<string> {
  switch (name) {
    case "get_dashboard_state":
      return state();

    case "create_message_template": {
      const spec: TemplateSpec = { channel: input.channel as "sms" | "email", body: String(input.body), subject: input.subject ? String(input.subject) : undefined };
      const item = await upsertItem("template", String(input.key), String(input.name), spec, { createdBy: who });
      changes.push({ kind: "template", key: item.key, name: item.name, action: "created", href: "/inbox" });
      return `Template "${item.name}" saved as ${item.key}. It appears in the Inbox reply composer.`;
    }

    case "create_automation": {
      const spec: AutomationSpec = {
        trigger: input.trigger as AutomationSpec["trigger"],
        offsets_days: (input.offsets_days as number[]) ?? [],
        channels: (input.channels as ("sms" | "email")[]) ?? [],
        requires_consent: (input.requires_consent as AutomationSpec["requires_consent"]) ?? null,
        max_sends_per_run: Number(input.max_sends_per_run ?? 25),
        sms: input.sms ? String(input.sms) : undefined,
        email_subject: input.email_subject ? String(input.email_subject) : undefined,
        email_body: input.email_body ? String(input.email_body) : undefined,
      };
      const res = await createAutomation({ key: String(input.key), name: String(input.name), spec, createdBy: who });
      if (!res.ok) return `Could not create it: ${res.error}`;
      changes.push({ kind: "automation", key: res.key, name: String(input.name), action: "created", href: "/automations" });
      return `Automation "${input.name}" created as ${res.key}, DISARMED. It shows on the Automations page under Held back; someone arms it there after reading the dry run.`;
    }

    case "create_checklist": {
      const spec: ChecklistSpec = { audience: input.audience as "office" | "crew", intro: input.intro ? String(input.intro) : undefined, steps: (input.steps as ChecklistSpec["steps"]) ?? [] };
      if (spec.steps.length === 0) return "A checklist needs at least one step.";
      const item = await upsertItem("checklist", String(input.key), String(input.name), spec, { createdBy: who });
      changes.push({ kind: "checklist", key: item.key, name: item.name, action: "created", href: "/team" });
      return `Checklist "${item.name}" saved for the ${spec.audience}. It shows on the Team page and on the Overview for that role when the checklists panel is in their layout.`;
    }

    case "set_overview_layout": {
      const res = await setLayout(input.role as "owner" | "office" | "crew", (input.panels as string[]) ?? [], who);
      if (!res.ok) return res.error ?? "Could not set the layout.";
      changes.push({ kind: "layout", key: String(input.role), name: `${input.role} overview`, action: "updated", href: "/" });
      return `Overview for ${input.role} is now: ${res.panels.join(" > ")}.${res.error ? ` ${res.error}` : ""}`;
    }

    case "remove_item": {
      const ok = await removeItem(input.kind as Kind, String(input.key));
      if (ok) changes.push({ kind: String(input.kind), key: String(input.key), name: String(input.key), action: "removed" });
      return ok ? `Removed ${input.kind} ${input.key}.` : `There is no ${input.kind} called ${input.key} built here. Seeded automations and templates cannot be removed from the Builder.`;
    }

    case "file_build_request": {
      const res = await fileBuildRequest({
        title: String(input.title), summary: String(input.summary), details: String(input.details),
        priority: (input.priority as "low" | "normal" | "high") ?? "normal", requestedBy: who,
      });
      changes.push({ kind: "build_request", key: res.key, name: String(input.title), action: "filed", href: "/builder" });
      return res.emailed ? "Filed and emailed to Voreli AI." : "Filed on the Builder page. Email was not configured, so tell Ciaran directly as well.";
    }

    default:
      return `Unknown tool ${name}.`;
  }
}

export async function POST(req: Request) {
  try {
    await requireSession();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return Response.json({ reply: "The Build Agent needs ANTHROPIC_API_KEY on this deployment.", changes: [] });

    const { messages } = (await req.json()) as { messages: Msg[] };
    const who = (await currentStaff())?.name;
    const client = new Anthropic({ apiKey: key });
    const changes: Change[] = [];

    const history: Anthropic.MessageParam[] = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    let reply = "";

    for (let round = 0; round < 8; round++) {
      const res = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: `${SYSTEM}\n\nThe person talking to you is ${who ?? "a HydroDam team member (they have not picked their name in the sidebar)"}.\n\nCURRENT STATE\n${await state()}`,
        tools,
        messages: history,
      });

      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (text) reply = text;
      if (uses.length === 0 || res.stop_reason !== "tool_use") break;

      history.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, who, changes);
        } catch (e) {
          out = `That failed: ${e instanceof Error ? e.message : "unknown error"}`;
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      history.push({ role: "user", content: results });
    }

    return Response.json({ reply: reply || "Done.", changes });
  } catch (e) {
    return Response.json({ reply: `Something went wrong: ${e instanceof Error ? e.message : "unknown error"}`, changes: [] });
  }
}
