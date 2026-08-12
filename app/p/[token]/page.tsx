import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Badge, Stepper } from "@/components/ui";
import { JOURNEY } from "@/lib/data";
import {
  db, getClient, getQuote, invoicesFor, jobsFor, nextVisitFor, propertyFor, quotesFor,
} from "@/lib/db";
import { longDate, money, shortDate, timeRange } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your HydroDam project", robots: { index: false, follow: false } };

/**
 * Client portal. In production the token is an opaque random string whose
 * sha256 is stored server-side with an expiry and a revocation flag — never
 * derived from a record id, so a link leaks nothing and cannot be forged.
 * Here it resolves against the seeded data so the surface is walkable.
 */
function resolveToken(token: string): string | null {
  const quoteId = token.replace(/^demo-/, "");
  const quote = getQuote(quoteId);
  if (quote) return quote.clientId;
  const client = db().clients.find((c) => c.id === quoteId);
  return client?.id ?? null;
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientId = resolveToken(token);
  if (!clientId) notFound();

  const client = getClient(clientId)!;
  const prop = propertyFor(clientId);
  const quotes = quotesFor(clientId);
  const jobs = jobsFor(clientId);
  const invoices = invoicesFor(clientId);
  const quote = quotes[quotes.length - 1];
  const job = jobs[jobs.length - 1];
  const nextVisit = job ? nextVisitFor(job.id) : undefined;
  const balance = invoices.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0);

  let step = 0;
  if (quote) step = 2;
  if (quote?.status === "approved") step = 3;
  if (quote?.status === "converted") step = 4;
  if (job?.status === "scheduled") step = 5;
  if (job && ["completed", "invoiced", "closed"].includes(job.status)) step = 6;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <header className="flex items-center gap-2.5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" fill="#1f8ab3" opacity="0.22" />
          <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" stroke="#1f8ab3" strokeWidth="1.5" />
          <path d="M8 12h8M8 15h8" stroke="#cc551e" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="font-display text-base font-bold text-ink">HydroDam</span>
      </header>

      <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">
        Hello {client.name.split(" ")[0]}
      </h1>
      <p className="mt-1.5 text-sm text-ink-dim">
        Everything about your flood barrier project, in one place.
        {prop && <> {prop.address}, {prop.city}.</>}
      </p>

      <section className="panel mt-7 rounded-2xl p-5">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Where things stand</p>
        <Stepper steps={[...JOURNEY]} current={step} />
      </section>

      {nextVisit && (
        <section className="panel mt-4 rounded-2xl border-line-bright p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-teal">Your next appointment</p>
          <p className="mt-2 font-display text-lg font-bold text-ink">{longDate(nextVisit.scheduledStart)}</p>
          <p className="text-sm text-ink-dim">{timeRange(nextVisit.scheduledStart, nextVisit.scheduledEnd)} · {nextVisit.title}</p>
          <p className="mt-3 text-xs text-ink-faint">
            We&apos;ll text you when the crew is on the way. Need to move it? Reply to any of our messages and we&apos;ll sort it.
          </p>
        </section>
      )}

      {quote && (
        <section className="panel mt-4 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your quote</p>
              <p className="mt-1.5 font-display text-lg font-bold text-ink">{quote.title}</p>
            </div>
            <Badge tone={["approved", "converted"].includes(quote.status) ? "good" : "teal"}>
              {quote.status === "converted" ? "Approved" : quote.status}
            </Badge>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {quote.openings.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-line/60 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{o.label}</span>
                  <span className="block font-mono text-[11px] text-ink-faint">
                    {o.widthIn}&quot; wide, protects to {o.protectionHeightIn}&quot; · {o.panelCount} planks
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{money(o.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-dim">Subtotal</dt><dd className="font-mono tabular-nums text-ink">{money(quote.subtotalCents, true)}</dd></div>
            {quote.discountCents > 0 && (
              <div className="flex justify-between"><dt className="text-ink-dim">Discount</dt><dd className="font-mono tabular-nums text-good">−{money(quote.discountCents, true)}</dd></div>
            )}
            <div className="flex justify-between font-display text-lg font-bold">
              <dt>Total</dt><dd className="font-mono tabular-nums text-teal">{money(quote.totalCents, true)}</dd>
            </div>
          </dl>

          {!["approved", "converted"].includes(quote.status) ? (
            <button className="mt-4 w-full rounded-xl bg-teal py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              Review and approve
            </button>
          ) : (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-xs text-good">
              <Icon name="check" size={14} />
              Approved{quote.approvedByName ? ` by ${quote.approvedByName}` : ""} on {shortDate(quote.approvedAt)}.
            </p>
          )}
        </section>
      )}

      {balance > 0 && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Balance due</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-ink">{money(balance, true)}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button className="w-full rounded-xl bg-good py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              Pay by bank transfer — no fee
            </button>
            <button className="w-full rounded-xl border border-line py-3 text-sm text-ink-dim transition-colors hover:border-line-bright hover:text-ink">
              Pay by card
            </button>
          </div>
          <p className="mt-2.5 text-xs text-ink-faint">
            Bank transfer clears in 3–5 business days. Card is instant but carries a processing fee.
          </p>
        </section>
      )}

      {job && ["completed", "invoiced", "closed"].includes(job.status) && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your documents</p>
          <ul className="mt-2.5 flex flex-col gap-2">
            {[
              ["5-year limited warranty", "warranty"],
              ["Purchase agreement, signed", "agreement"],
              ["Installation and care guide", "guide"],
            ].map(([label, key]) => (
              <li key={key}>
                <span className="flex items-center gap-2.5 rounded-xl border border-line/60 p-3 text-sm text-ink-dim">
                  <Icon name="file" size={15} className="text-teal" />
                  {label}
                </span>
              </li>
            ))}
          </ul>
          {job.warrantyEndsOn && (
            <p className="mt-3 text-xs text-ink-faint">
              Your warranty runs to {shortDate(job.warrantyEndsOn)}.
            </p>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-faint">
        <p>Hydro Dam LLC · 6140 Ulmerton Road, Clearwater FL 33760 · FL contractor CBC1269077</p>
        <p className="mt-1">This page is private to you. Please don&apos;t forward the link.</p>
      </footer>
    </div>
  );
}
