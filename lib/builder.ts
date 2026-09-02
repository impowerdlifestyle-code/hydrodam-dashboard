import "server-only";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { MAIL_LIVE, p, sendEmail, shell } from "@/lib/mail";
import { MESSAGE_TEMPLATES } from "@/lib/data";
import { PANELS, DEFAULT_LAYOUTS, type PanelKey } from "@/lib/layout";
import type { Role } from "@/lib/types";

/**
 * The store behind the Build Agent. Everything the team builds from inside the
 * dashboard lands here as one row per thing, with a jsonb spec per kind, so a
 * new template or automation never needs a deploy. Anything that does need
 * code is filed as a build_request and emailed to Voreli.
 */

export type Kind = "template" | "automation" | "checklist" | "layout" | "build_request";

export type TemplateSpec = { channel: "sms" | "email"; body: string; subject?: string };
export type AutomationSpec = {
  trigger: Trigger;
  offsets_days: number[];
  channels: ("sms" | "email")[];
  requires_consent: "sms_marketing" | "email_marketing" | null;
  max_sends_per_run: number;
  sms?: string;
  email_subject?: string;
  email_body?: string;
};
export type ChecklistSpec = { audience: "office" | "crew"; intro?: string; steps: { label: string; help?: string; required?: boolean }[] };
export type LayoutSpec = { panels: PanelKey[] };
export type BuildRequestSpec = { summary: string; details: string; priority: "low" | "normal" | "high"; requested_by?: string; emailed: boolean };

export type Item<S = Record<string, unknown>> = {
  id: string;
  kind: Kind;
  key: string;
  name: string;
  spec: S;
  status: "draft" | "live" | "archived" | "sent" | "done";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const TRIGGERS = {
  "request.created": "a new request comes in (offsets count from the request date)",
  "visit.scheduled": "a visit is on the calendar (offsets count from the visit date, so -1 is the day before)",
  "quote.sent": "a quote has been sent and not answered (offsets count from the send date)",
  "invoice.sent": "an invoice is unpaid (offsets count from the DUE date, so -3 is a courtesy note and +14 is a chase)",
  "job.closed": "a job has been closed (offsets count from the close date)",
  "lead.status_changed": "a lead went quiet after contact (marketing consent required)",
} as const;
export type Trigger = keyof typeof TRIGGERS;

const ITEM_COLS = "id,kind,key,name,spec,status,created_by,created_at,updated_at";

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item";

async function company(): Promise<string> {
  return pg.rpc<string>("company_id", {});
}

export async function listItems<S = Record<string, unknown>>(kind?: Kind): Promise<Item<S>[]> {
  if (!SUPABASE_LIVE) return [];
  const q: Record<string, string> = { select: ITEM_COLS, status: "neq.archived", order: "created_at.desc", limit: "200" };
  if (kind) q.kind = `eq.${kind}`;
  return pg.select<Item<S>>("builder_items", q);
}

export async function getItem<S = Record<string, unknown>>(kind: Kind, key: string): Promise<Item<S> | undefined> {
  if (!SUPABASE_LIVE) return undefined;
  const [row] = await pg.select<Item<S>>("builder_items", { select: ITEM_COLS, kind: `eq.${kind}`, key: `eq.${key}`, limit: "1" });
  return row;
}

export async function upsertItem<S>(kind: Kind, key: string, name: string, spec: S, opts: { status?: Item["status"]; createdBy?: string } = {}): Promise<Item<S>> {
  if (!SUPABASE_LIVE) throw new Error("No database configured.");
  const [row] = await pg.insert<Item<S>>(
    "builder_items",
    { company_id: await company(), kind, key, name, spec, status: opts.status ?? "live", created_by: opts.createdBy ?? null },
    { onConflict: "company_id,kind,key" }
  );
  return row;
}

export async function removeItem(kind: Kind, key: string): Promise<boolean> {
  if (!SUPABASE_LIVE) return false;
  const item = await getItem(kind, key);
  if (!item) return false;
  if (kind === "automation") {
    await pg.remove("automation_config", { automation_id: `eq.${key}` });
  }
  await pg.patch("builder_items", { id: `eq.${item.id}` }, { status: "archived" });
  return true;
}

// ---------------------------------------------------------------- templates

export type MessageTemplate = { key: string; name: string; channel: "sms" | "email"; body: string; custom?: boolean };

export async function messageTemplates(): Promise<MessageTemplate[]> {
  const built = await listItems<TemplateSpec>("template");
  const custom: MessageTemplate[] = built.map((t) => ({ key: t.key, name: t.name, channel: t.spec.channel, body: t.spec.body, custom: true }));
  const keys = new Set(custom.map((t) => t.key));
  return [...custom, ...MESSAGE_TEMPLATES.filter((t) => !keys.has(t.key)).map((t) => ({ key: t.key, name: t.name, channel: t.channel, body: t.body }))];
}

/** Message text for automations the agent built, keyed by automation_id. */
export async function customAutomationTemplates(): Promise<Record<string, AutomationSpec>> {
  const built = await listItems<AutomationSpec>("automation");
  return Object.fromEntries(built.map((a) => [a.key, a.spec]));
}

// -------------------------------------------------------------- automations

export async function createAutomation(input: {
  key: string; name: string; spec: AutomationSpec; createdBy?: string;
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const s = input.spec;
  if (!(s.trigger in TRIGGERS)) return { ok: false, error: `Unknown trigger. Use one of: ${Object.keys(TRIGGERS).join(", ")}.` };
  if (!Array.isArray(s.offsets_days) || s.offsets_days.length === 0 || s.offsets_days.some((n) => !Number.isInteger(n) || Math.abs(n) > 365)) {
    return { ok: false, error: "offsets_days must be a non-empty list of whole days, e.g. [3, 7, 14]." };
  }
  if (s.channels.includes("sms") && !s.sms?.trim()) return { ok: false, error: "An SMS channel needs sms text." };
  if (s.channels.includes("email") && !(s.email_subject?.trim() && s.email_body?.trim())) return { ok: false, error: "An email channel needs email_subject and email_body." };
  if (s.trigger === "lead.status_changed" && !s.requires_consent) s.requires_consent = "email_marketing";
  if (s.sms && !/\bstop\b/i.test(s.sms) && s.requires_consent === "sms_marketing") s.sms = `${s.sms.trim()} Reply STOP to opt out.`;

  const key = slug(input.key);
  await pg.insert(
    "automation_config",
    {
      company_id: await company(),
      automation_id: key,
      name: input.name,
      trigger_event: s.trigger,
      armed: false,
      epoch_at: null,
      max_sends_per_run: Math.min(Math.max(1, s.max_sends_per_run || 25), 200),
      offsets_days: s.offsets_days,
      channels: s.channels,
      requires_consent: s.requires_consent ?? null,
    },
    { onConflict: "company_id,automation_id" }
  );
  await upsertItem<AutomationSpec>("automation", key, input.name, s, { createdBy: input.createdBy });
  return { ok: true, key };
}

// ------------------------------------------------------------------ layouts

export async function layoutFor(role: Role): Promise<PanelKey[]> {
  const item = await getItem<LayoutSpec>("layout", role);
  const panels = item?.spec.panels?.filter((k): k is PanelKey => k in PANELS);
  return panels && panels.length ? panels : DEFAULT_LAYOUTS[role];
}

export async function setLayout(role: Role, panels: string[], createdBy?: string): Promise<{ ok: boolean; error?: string; panels: PanelKey[] }> {
  const valid = panels.filter((k): k is PanelKey => k in PANELS);
  const bad = panels.filter((k) => !(k in PANELS));
  if (valid.length === 0) return { ok: false, error: `No valid panels. Choose from: ${Object.keys(PANELS).join(", ")}.`, panels: [] };
  await upsertItem<LayoutSpec>("layout", role, `${role} overview`, { panels: [...new Set(valid)] }, { createdBy });
  return { ok: true, error: bad.length ? `Ignored unknown panels: ${bad.join(", ")}.` : undefined, panels: valid };
}

// ------------------------------------------------------------ build requests

const VORELI = "ciaran@voreli.ai";

export async function fileBuildRequest(input: {
  title: string; summary: string; details: string; priority?: BuildRequestSpec["priority"]; requestedBy?: string;
}): Promise<{ ok: boolean; key: string; emailed: boolean }> {
  const key = `${slug(input.title)}_${Date.now().toString(36)}`;
  const spec: BuildRequestSpec = {
    summary: input.summary, details: input.details, priority: input.priority ?? "normal",
    requested_by: input.requestedBy, emailed: false,
  };
  let emailed = false;
  if (MAIL_LIVE) {
    const res = await sendEmail({
      to: VORELI,
      subject: `[HydroDam Ops build request] ${input.title}`,
      replyTo: "info@thehydrodam.com",
      html: shell({
        heading: input.title,
        body:
          p(`<strong>Priority:</strong> ${spec.priority}${spec.requested_by ? ` &middot; <strong>From:</strong> ${spec.requested_by}` : ""}`) +
          p(`<strong>Summary.</strong> ${input.summary}`) +
          p(input.details.replace(/\n/g, "<br>")),
        cta: { label: "Open the Builder", href: "https://hydrodam-dashboard.vercel.app/builder" },
      }),
    });
    emailed = res.ok;
  }
  spec.emailed = emailed;
  await upsertItem<BuildRequestSpec>("build_request", key, input.title, spec, { status: "sent", createdBy: input.requestedBy });
  return { ok: true, key, emailed };
}
