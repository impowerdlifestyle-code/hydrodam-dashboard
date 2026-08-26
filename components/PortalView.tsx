import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Badge, Stepper } from "@/components/ui";
import { JOURNEY } from "@/lib/data";
import {
  getClient, invoicesFor, isApprovable, jobsFor, nextVisitFor, portalQuote, propertyFor,
} from "@/lib/db";
import { longDate, money, shortDate, timeRange } from "@/lib/format";

/**
 * Everything the customer sees at /p/:token, with the token factored out.
 *
 * Ops needs to look at this page too — "what did we actually send them" is the
 * first question on any support call — and the only way to do that used to be
 * minting a real link, which hands a live customer credential to whoever
 * happened to be at the keyboard. So the view takes a clientId and the caller
 * supplies the credential-bearing hrefs: /p/:token passes them, the internal
 * preview passes nothing and the CTAs render as inert labels.
 */
export function PortalView({
  clientId,
  approveHref,
}: {
  clientId: string;
  approveHref?: string;
}) {
  const client = getClient(clientId);
  if (!client) return null;

  const prop = propertyFor(clientId);
  const jobs = jobsFor(clientId);
  const invoices = invoicesFor(clientId);
  const quote = portalQuote(clientId);
  const job = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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

          {["approved", "converted"].includes(quote.status) ? (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-xs text-good">
              <Icon name="check" size={14} />
              Approved{quote.approvedByName ? ` by ${quote.approvedByName}` : ""} on {shortDate(quote.approvedAt)}.
            </p>
          ) : isApprovable(quote) ? (
            approveHref ? (
              <Link
                href={approveHref}
                className="mt-4 block w-full rounded-xl bg-teal py-3.5 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Review and approve
              </Link>
            ) : (
              <p className="mt-4 block w-full rounded-xl bg-teal/40 py-3.5 text-center text-sm font-semibold text-white/70">
                Review and approve
              </p>
            )
          ) : (
            <p className="mt-4 rounded-xl border border-line/60 px-3 py-2.5 text-xs leading-relaxed text-ink-dim">
              This quote is {quote.status} and can no longer be approved online. Get in touch and
              HydroDam will send a fresh one.
            </p>
          )}
        </section>
      )}

      {balance > 0 && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Balance due</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-ink">{money(balance, true)}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            HydroDam will send payment details with your invoice. Bank transfer is preferred and
            carries no fee; a card payment carries a processing fee on an amount this size.
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
