import { segmentsFor } from "@/lib/format";

/**
 * The wording rules for a text the office edits, shared by the editor in the
 * browser and the save on the server so both refuse the same things.
 *
 * Stored text uses the engine's own tokens, `{{first_name}}`. People edit
 * `{first name}`, which reads like the sentence it is part of.
 */

export const TOKEN_LABELS: Record<string, string> = {
  first_name: "first name",
  company_phone: "office phone",
  visit_date: "appointment date",
  visit_window: "appointment time",
  address: "address",
  quote_number: "quote number",
  quote_total: "quote total",
  invoice_number: "invoice number",
  balance: "balance due",
  due_date: "due date",
  days_overdue: "days overdue",
  portal_url: "portal link",
};

/** What a preview fills each field with. Obviously a sample, never a real customer. */
export const SAMPLE: Record<string, string> = {
  first_name: "Maria",
  company_phone: "(727) 613-1415",
  visit_date: "Thursday, Oct 2",
  visit_window: "9:00 AM to 11:00 AM",
  address: "412 Bayshore Dr, Clearwater",
  quote_number: "2108",
  quote_total: "$1,850.00",
  invoice_number: "1042",
  balance: "$925.00",
  due_date: "2026-10-15",
  days_overdue: "3",
  portal_url: "https://hydrodam-dashboard.vercel.app/p/sample",
};

export const OPT_OUT_LINE = "Reply STOP to opt out.";

const BY_LABEL = Object.fromEntries(Object.entries(TOKEN_LABELS).map(([k, v]) => [v, k]));

export const toFriendly = (raw: string): string =>
  raw.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (TOKEN_LABELS[k.toLowerCase()] ? `{${TOKEN_LABELS[k.toLowerCase()]}}` : m));

export const toRaw = (friendly: string): string =>
  friendly.replace(/\{\s*([a-z ]+?)\s*\}/gi, (m, label: string) => {
    const key = BY_LABEL[label.toLowerCase()];
    return key ? `{{${key}}}` : m;
  });

export function withOptOutLine(text: string): string {
  const t = text.trim();
  return /\bstop\b/i.test(t) ? t : `${t} ${OPT_OUT_LINE}`;
}

export function preview(friendly: string, marketing: boolean): string {
  const filled = toRaw(friendly)
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => SAMPLE[k.toLowerCase()] ?? "")
    .replace(/[ ]{2,}/g, " ")
    .trim();
  return marketing ? withOptOutLine(filled) : filled;
}

export type WordingCheck = { errors: string[]; warnings: string[]; preview: string; segments: number };

/** `allowed` is the fields this automation actually has values for. */
export function checkWording(friendly: string, allowed: string[], marketing: boolean): WordingCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = friendly.trim();

  if (!text) errors.push("The text is empty.");
  if (/[—–]/.test(text)) errors.push("Remove the long dash. Use a comma or a full stop instead.");
  if (/FEMA[- ]?(compliant|certified|approved)/i.test(text)) errors.push("Do not call the barriers FEMA-compliant or FEMA-certified.");
  if (text.length > 480) errors.push("Keep it under 480 characters.");

  const fields = [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim().toLowerCase());
  const unknown = fields.filter((f) => !BY_LABEL[f]);
  const unavailable = fields.filter((f) => BY_LABEL[f] && !allowed.includes(BY_LABEL[f]));
  if (unknown.length) warnings.push(`Not a field we can fill: {${[...new Set(unknown)].join("}, {")}}. It will be sent exactly as typed.`);
  if (unavailable.length) warnings.push(`This automation has no value for {${[...new Set(unavailable)].join("}, {")}}, so it will be left blank.`);
  if (/insurance|premium/i.test(text)) warnings.push("Mentions insurance. Make sure it promises no savings.");

  const shown = preview(text, marketing);
  const segments = segmentsFor(shown).segments;
  if (segments > 2) warnings.push(`This is ${segments} texts long on most phones and costs ${segments} times as much. Aim for 2 or fewer.`);
  return { errors, warnings, preview: shown, segments };
}

const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);

/** "3, 7 and 14 days after the day the quote was sent" in words a person would say. */
export function describeTiming(offsets: number[], anchor?: string): string {
  if (!anchor || !offsets.length) return "Only when someone sends it.";
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  const group = (ns: number[], side: "before" | "after") => {
    const n = ns.map((x) => String(Math.abs(x)));
    const unit = ns.length === 1 && Math.abs(ns[0]) === 1 ? "day" : "days";
    return `${and(n)} ${unit} ${side} ${side === "before" ? anchor.replace(/^the day of /, "") : anchor}`;
  };
  const parts = [
    ...(sorted.some((n) => n < 0) ? [group(sorted.filter((n) => n < 0).reverse(), "before")] : []),
    ...(sorted.includes(0) ? [`on ${anchor}`] : []),
    ...(sorted.some((n) => n > 0) ? [group(sorted.filter((n) => n > 0), "after")] : []),
  ];
  const list = and(parts);
  return `${list[0].toUpperCase()}${list.slice(1)}, in the morning run (around 9am).`;
}
