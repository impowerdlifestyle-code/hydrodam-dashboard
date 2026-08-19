import "server-only";
import { esc, p, shell } from "@/lib/mail";
import { money } from "@/lib/format";

/**
 * What each automation actually says.
 *
 * Written as HydroDam, to a homeowner who has just had a foot of water through
 * their front door — plain, specific, no marketing voice. Every one of these
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
  address?: string;
  daysOverdue?: number;
};

export type Rendered = { subject: string; html: string; sms: string };

const PHONE = "(727) 613-1415";

const sign = (body: string) =>
  body + p(`Any questions, just reply to this email or call us on ${PHONE}.`) + p("— The HydroDam team");

type Builder = (c: TemplateContext) => Rendered;

export const TEMPLATES: Record<string, Builder> = {
  speed_to_lead: (c) => ({
    subject: "We've got your flood barrier enquiry",
    html: shell({
      heading: `Thanks for getting in touch, ${esc(c.firstName)}`,
      body: sign(
        p("We have your enquiry and someone will call you within one business day to arrange a free on-site assessment.") +
        p("The assessment is how we get you a real number: we measure every opening you want protected, check the ground surface each barrier has to seal against, and confirm what the install actually involves. It takes about half an hour.") +
        p("If a storm is already forecast, call us instead of waiting — we will prioritise you.")
      ),
    }),
    sms: `Hi ${c.firstName}, HydroDam here. We have your flood barrier enquiry and will call within one business day to book your free assessment. Questions? ${PHONE}`,
  }),

  reminder_24h: (c) => ({
    subject: `Reminder: we're with you tomorrow${c.visitWindow ? `, ${c.visitWindow}` : ""}`,
    html: shell({
      heading: "We're with you tomorrow",
      body: sign(
        p(`Just a reminder that HydroDam is visiting ${c.address ? esc(c.address) : "you"} tomorrow${c.visitWindow ? `, between ${esc(c.visitWindow)}` : ""}.`) +
        p("Please make sure we can get to every opening you want protected — moving planters, furniture and vehicles out of the way beforehand saves us both time.") +
        p("If tomorrow no longer works, call us and we will move it.")
      ),
    }),
    sms: `HydroDam reminder: we're with you tomorrow${c.visitWindow ? ` ${c.visitWindow}` : ""}. Please clear access to the openings. Need to move it? ${PHONE}`,
  }),

  on_my_way: (c) => ({
    subject: "Your HydroDam crew is on the way",
    html: shell({
      heading: "On the way",
      body: sign(p("Our crew has left and is heading to you now.")),
    }),
    sms: `HydroDam: your crew is on the way to you now. ${PHONE}`,
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
        p("If the scope or the price is not right, tell us — it is easier to change a quote than to lose a job over something we could have adjusted.")
      ),
      cta: c.portalUrl ? { label: "Review your quote", href: c.portalUrl } : undefined,
    }),
    sms: `HydroDam: checking in on your quote${c.quoteNumber ? ` #${c.quoteNumber}` : ""}. Anything you'd like explained or adjusted? ${PHONE}`,
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
          }${c.daysOverdue && c.daysOverdue > 0 ? ` — ${c.daysOverdue} day${c.daysOverdue === 1 ? "" : "s"} ago` : ""}.`
        ) +
        p("Bank transfer is the cheapest way to settle it and costs you nothing; card carries a processing fee on an amount this size. Reply and we will send whichever details you prefer.") +
        p("If this has already been paid, ignore this and let us know so we can chase our own records.")
      ),
      cta: c.portalUrl ? { label: "View your invoice", href: c.portalUrl } : undefined,
    }),
    sms: `HydroDam: invoice${c.invoiceNumber ? ` #${c.invoiceNumber}` : ""}${c.balanceCents ? ` for ${money(c.balanceCents, true)}` : ""} is outstanding. Already paid? Let us know. ${PHONE}`,
  }),

  review_request: (c) => ({
    subject: "How did we do?",
    html: shell({
      heading: `How did we do, ${esc(c.firstName)}?`,
      body: sign(
        p("Your barriers are in and your 5-year warranty has started. If we did a good job, a short review helps other people on your street find us — most of our work comes from neighbours who saw an installation nearby.") +
        p("If anything is not right, reply to this instead. We would much rather fix it than read about it.")
      ),
      cta: { label: "Leave a review", href: "https://g.page/r/thehydrodam/review" },
    }),
    sms: `HydroDam: hope you're happy with your barriers. A quick review helps your neighbours find us. Anything not right? Just reply.`,
  }),

  dormant_nurture: (c) => ({
    subject: "Still worth protecting before the season",
    html: shell({
      heading: "Still thinking about flood protection?",
      body: sign(
        p("You asked us about flood barriers a while back and we never got to a firm plan. No pressure — but if it is still on the list, the time to sort it is before a storm is named, not after.") +
        p("The assessment is free and there is no obligation. If it is no longer relevant, reply STOP and we will leave you alone.")
      ),
    }),
    sms: `HydroDam: still thinking about flood barriers? Free assessment, no obligation. Reply STOP to opt out.`,
  }),

  storm_surge: (c) => ({
    subject: "Storm watch — get your barriers up",
    html: shell({
      heading: "Storm watch",
      body: sign(
        p("There is a storm in the forecast for our area. If you have HydroDam barriers, now is the time to put them up rather than the night before.") +
        p("If you have lost your guide or are unsure about anything, call us and we will walk you through it.")
      ),
    }),
    sms: `HydroDam storm watch: deploy your barriers now, not the night before. Need a hand? ${PHONE}`,
  }),
};

export function render(automationId: string, ctx: TemplateContext): Rendered | null {
  const build = TEMPLATES[automationId];
  return build ? build(ctx) : null;
}
