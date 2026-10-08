import "server-only";
import { esc, p, shell } from "@/lib/mail";
import { money } from "@/lib/format";

/**
 * What each automation actually says.
 *
 * Written as HydroDam, to a homeowner who has just had a foot of water through
 * their front door: plain, specific, no marketing voice. Every one of these
 * goes out unattended, so none of them promises anything the system cannot
 * verify: no dates that are not booked, no prices that are not quoted.
 *
 * SMS bodies are kept inside one GSM-7 segment (160 chars) wherever possible,
 * because two segments cost twice as much across three thousand contacts.
 */

export type TemplateContext = {
  firstName: string;
  companyPhone: string;
  /** Absolute, and only present when a portal link has been minted. */
  portalUrl?: string;
  quoteNumber?: number;
  quoteTotalCents?: number;
  invoiceNumber?: number;
  balanceCents?: number;
  dueDate?: string;
  visitDate?: string;
  visitWindow?: string;
  /** "on-site assessment", "installation": what the visit is, in the customer's words. */
  visitKind?: string;
  /** "tomorrow", "today", "in 3 days": follows the timing the office set. */
  visitDay?: string;
  /** First name of whoever is assigned. */
  crewName?: string;
  address?: string;
  daysOverdue?: number;
};

export type Rendered = { subject: string; html: string; sms: string };

const PHONE = "(727) 613-1415";
const REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJz4jfpxGKmaER_CXaCbjDOgU";

const sign = (body: string) =>
  body + p(`Any questions, just reply to this email or call us on ${PHONE}.`) + p("The HydroDam team");

type Builder = (c: TemplateContext) => Rendered;

export const VISIT_KIND_LABEL: Record<string, string> = {
  assessment: "on-site assessment",
  measure: "measure visit",
  install: "installation",
  service: "service visit",
  thirty_day_check: "30-day check",
};

/** A reminder is retimed by the office, so it cannot hard-code "tomorrow". */
export function visitDayFor(offsetDays: number): string {
  if (offsetDays === 0) return "today";
  if (offsetDays === -1) return "tomorrow";
  return offsetDays < 0 ? `in ${-offsetDays} days` : "";
}

const VISIT_PREP: Record<string, string> = {
  "on-site assessment":
    "The assessment takes about an hour. We measure every opening you want protected and check the ground each barrier has to seal against, so please make sure we can get to them.",
  "measure visit":
    "We will take final measurements of every opening, so please make sure we can get to them.",
  installation:
    "Please make sure we can get to every opening you want protected. Moving planters, furniture and vehicles out of the way beforehand saves us both time.",
};

const detail = (label: string, value?: string) =>
  value ? `<strong>${label}:</strong> ${esc(value)}<br>` : "";

export const TEMPLATES: Record<string, Builder> = {
  speed_to_lead: (c) => ({
    subject: "We've got your flood barrier request",
    html: shell({
      heading: `Thanks for getting in touch, ${esc(c.firstName)}`,
      body: sign(
        p("We have your request and someone will call you within one business day to arrange a free on-site assessment.") +
        (c.portalUrl
          ? p("Or skip the phone tag: open your project below, pick a time for the assessment that suits you, and follow every step from there. Your itemized estimate and documents will appear on the same page.")
          : "") +
        p("The assessment is how we get you a real number: we measure every opening you want protected, check the ground surface each barrier has to seal against, and confirm what the install actually involves. It takes about an hour.") +
        p("If a storm is already forecast, call us instead of waiting and we will prioritize you.")
      ),
      cta: c.portalUrl ? { label: "Open your project and book", href: c.portalUrl } : undefined,
    }),
    sms: `Hi ${c.firstName}, HydroDam here. We got your flood barrier request and will call within one business day to book your free assessment.${c.portalUrl ? ` Or pick a time online: ${c.portalUrl}` : ""} Questions? Call ${PHONE}.`,
  }),

  reminder_24h: (c) => {
    const kind = c.visitKind ?? "visit";
    const day = c.visitDay || "coming up";
    const when = [c.visitDate, c.visitWindow].filter(Boolean).join(", ");
    return {
      subject: `Reminder: your HydroDam ${kind} is ${day}${c.visitWindow ? `, ${c.visitWindow}` : ""}`,
      html: shell({
        heading: `Your ${esc(kind)} is ${esc(day)}`,
        body: sign(
          p(`Hi ${esc(c.firstName)}, a reminder that HydroDam is visiting you ${esc(day)}. Here are the details.`) +
          p(
            detail("What", kind[0].toUpperCase() + kind.slice(1)) +
            detail("When", when) +
            detail("Where", c.address) +
            detail("Who", c.crewName ? `${c.crewName} from HydroDam` : undefined)
          ) +
          p(VISIT_PREP[kind] ?? "Please make sure we can get to every opening we are working on.") +
          p("If the time no longer works, call us and we will move it.")
        ),
        cta: c.portalUrl ? { label: "Open your project", href: c.portalUrl } : undefined,
      }),
      sms: `Hi ${c.firstName}, HydroDam here. Your ${kind} is ${day}${when ? `, ${when}` : ""}${c.address ? ` at ${c.address}` : ""}.${c.crewName ? ` ${c.crewName} will be there.` : ""} Need to move it? Call ${PHONE}.`,
    };
  },

  on_my_way: (c) => ({
    subject: "HydroDam is on the way",
    html: shell({
      heading: "On the way",
      body: sign(p(`${esc(c.crewName ?? "Our crew")} has left and is heading to you now.`)),
    }),
    sms: `Hi ${c.firstName}, ${c.crewName ? `${c.crewName} from HydroDam` : "your HydroDam crew"} is on the way${c.address ? ` to ${c.address}` : ""}${c.visitKind ? ` for your ${c.visitKind}` : ""}. Call ${PHONE} if you need us.`,
  }),

  quote_followup: (c) => ({
    subject: `Your HydroDam quote${c.quoteNumber ? ` #${c.quoteNumber}` : ""}`,
    html: shell({
      heading: `Still thinking it over, ${esc(c.firstName)}?`,
      body: sign(
        p(
          `We sent you a quote${c.quoteNumber ? ` (#${c.quoteNumber})` : ""}${
            c.quoteTotalCents ? ` for ${money(c.quoteTotalCents, true)}` : ""
          } and wanted to check whether anything needs explaining.`
        ) +
        p("The most common question is what happens on install day, and the answer is that it is one visit for most homes. We fit the posts, fit the planks, and show you how to put them up and take them down yourself before we leave.") +
        p("If the scope or the price is not right, tell us. It is easier to change a quote than to lose a job over something we could have adjusted.")
      ),
      cta: c.portalUrl ? { label: "Review your quote", href: c.portalUrl } : undefined,
    }),
    sms: `Hi ${c.firstName}, HydroDam here, checking in on your quote${c.quoteNumber ? ` #${c.quoteNumber}` : ""}. If anything needs explaining or changing, reply here or call ${PHONE}.`,
  }),

  invoice_reminders: (c) => ({
    subject:
      c.daysOverdue && c.daysOverdue > 0
        ? `Overdue: invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""}`
        : `Invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""} from HydroDam`,
    html: shell({
      heading:
        c.daysOverdue && c.daysOverdue > 0
          ? `Invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""} is past due`
          : `Invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""}`,
      body: sign(
        p(
          `${c.balanceCents ? `${money(c.balanceCents, true)} is outstanding` : "There is a balance outstanding"}${
            c.dueDate ? `, due ${esc(c.dueDate)}` : ""
          }${c.daysOverdue && c.daysOverdue > 0 ? `, ${c.daysOverdue} day${c.daysOverdue === 1 ? "" : "s"} ago` : ""}.`
        ) +
        p("Bank transfer is the cheapest way to settle it and costs you nothing; card carries a processing fee on an amount this size. Reply and we will send whichever details you prefer.") +
        p("If this has already been paid, ignore this and let us know so we can chase our own records.")
      ),
      cta: c.portalUrl ? { label: "View your invoice", href: c.portalUrl } : undefined,
    }),
    sms: `Hi ${c.firstName}, HydroDam here. Your invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""}${c.balanceCents ? ` for ${money(c.balanceCents, true)}` : ""} is still open. If you have already paid, reply and let us know. Questions? Call ${PHONE}.`,
  }),

  review_request: (c) => ({
    subject: "How did we do?",
    html: shell({
      heading: `How did we do, ${esc(c.firstName)}?`,
      body: sign(
        p("Your barriers are in and your 5-year warranty has started. If we did a good job, a short review helps other people on your street find us. Most of our work comes from neighbours who saw an installation nearby.") +
        p("If anything is not right, reply to this instead. We would much rather fix it than read about it.")
      ),
      cta: { label: "Leave a review", href: REVIEW_URL },
    }),
    sms: `Hi ${c.firstName}, HydroDam here. We hope you're happy with your barriers. A short review helps your neighbors find us: ${REVIEW_URL} If anything isn't right, reply and tell us.`,
  }),

  dormant_nurture: (c) => ({
    subject: "Still worth protecting before the season",
    html: shell({
      heading: "Still thinking about flood protection?",
      body: sign(
        p("You asked us about flood barriers a while back and we never got to a firm plan. No pressure, but if it is still on the list, the time to sort it is before a storm is named, not after.") +
        p("The assessment is free and there is no obligation. If it is no longer relevant, reply STOP and we will leave you alone.")
      ),
    }),
    sms: `Hi ${c.firstName}, HydroDam here. If flood barriers are still on your list, the assessment is free and there is no obligation. Call ${PHONE} to book. Reply STOP to opt out.`,
  }),

  storm_surge: () => ({
    subject: "Storm watch: get your barriers up",
    html: shell({
      heading: "Storm watch",
      body: sign(
        p("There is a storm in the forecast for our area. If you have HydroDam barriers, now is the time to put them up rather than the night before.") +
        p("If you have lost your guide or are unsure about anything, call us and we will walk you through it.")
      ),
    }),
    sms: `HydroDam storm watch: a storm is in the forecast. Put your barriers up now instead of waiting for the night before. Need a hand? Call ${PHONE}.`,
  }),
};

export function render(automationId: string, ctx: TemplateContext): Rendered | null {
  const build = TEMPLATES[automationId];
  return build ? build(ctx) : null;
}

/** Tokens the Build Agent may use in a message it writes. */
export const TOKENS = [
  "first_name", "company_phone", "quote_number", "quote_total", "invoice_number", "balance",
  "due_date", "visit_date", "visit_window", "visit_kind", "visit_day", "crew_name", "address", "days_overdue",
  "portal_url",
] as const;

export function fill(text: string, c: TemplateContext): string {
  const values: Record<string, string> = {
    first_name: c.firstName,
    company_phone: c.companyPhone,
    quote_number: c.quoteNumber ? String(c.quoteNumber) : "",
    quote_total: c.quoteTotalCents ? money(c.quoteTotalCents, true) : "",
    invoice_number: c.invoiceNumber ? String(c.invoiceNumber) : "",
    balance: c.balanceCents ? money(c.balanceCents, true) : "",
    due_date: c.dueDate ?? "",
    visit_date: c.visitDate ?? "",
    visit_window: c.visitWindow ?? "",
    visit_kind: c.visitKind ?? "",
    visit_day: c.visitDay ?? "",
    crew_name: c.crewName ?? "",
    address: c.address ?? "",
    days_overdue: c.daysOverdue != null ? String(c.daysOverdue) : "",
    portal_url: c.portalUrl ?? "",
  };
  const blank = (k: string) => !values[k.toLowerCase()];

  // A field with no value takes its connecting word with it ("at {{address}}"),
  // and a sentence that opens on one ("{{crew_name}} will be there.") goes
  // entirely, so a missing detail never leaves "at ." or " will be there."
  const line = (text: string) => text
    .split(/(?<=[.?!])[ \t]+/)
    .filter((sentence) => {
      const lead = sentence.match(/^\{\{\s*([a-z_]+)\s*\}\}/i);
      return !lead || !blank(lead[1]);
    })
    .map((sentence) =>
      sentence
        .replace(/(?:\s+(?:at|to|for|on|by|from|between))?\s*#?\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (blank(k) ? "" : m))
        .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => values[k.toLowerCase()] ?? "")
    )
    .join(" ")
    .replace(/\s+([,.?!])/g, "$1")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/,([.?!])/g, "$1")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  // Line by line, so a paragraph break in an email body or a text survives.
  return text.split("\n").map(line).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** An automation the team built in the dashboard: plain text with tokens, no code. */
export function renderCustom(
  spec: { sms?: string; email_subject?: string; email_body?: string } | undefined,
  ctx: TemplateContext
): Rendered | null {
  if (!spec) return null;
  const subject = spec.email_subject ? fill(spec.email_subject, ctx) : "";
  const body = spec.email_body ? fill(spec.email_body, ctx) : "";
  return {
    subject,
    html: body ? shell({ heading: subject, body: sign(body.split(/\n{2,}/).map((para) => p(para.replace(/\n/g, "<br>"))).join("")) }) : "",
    sms: spec.sms ? fill(spec.sms, ctx) : "",
  };
}
