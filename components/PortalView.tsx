import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PortalBooking } from "@/components/PortalBooking";
import { PortalFrame } from "@/components/PortalFrame";
import { Badge } from "@/components/ui";
import { PORTAL_JOURNEY } from "@/lib/data";
import { availableSlots, completedAssessment, upcomingAssessment } from "@/lib/booking";
import {
  db, getClient, invoicesFor, isApprovable, jobsFor, nextVisitFor, portalQuote, propertyFor,
} from "@/lib/db";
import { DOC_KINDS, listDocuments } from "@/lib/documents";
import { longDate, money, shortDate, timeRange } from "@/lib/format";
import { portalJourney } from "@/lib/journey";
import { qbEstimatesForClient, type QbEstimate } from "@/lib/quickbooks";

/**
 * Everything the customer sees at /p/:token, with the token factored out.
 *
 * Ops needs to look at this page too, and the only way to do that used to be
 * minting a real link, which hands a live customer credential to whoever was
 * at the keyboard. So the view takes a clientId and the caller supplies the
 * credential-bearing hrefs and the token; the internal preview passes none of
 * them and every CTA renders inert.
 */
export async function PortalView({
  clientId,
  token,
  approveHref,
  docHref,
  estimateHref,
}: {
  clientId: string;
  token?: string;
  approveHref?: string;
  /** Builds the credential-bearing link for a file. Absent in the office preview, so files list but do not open. */
  docHref?: (docId: string) => string;
  estimateHref?: (estimateId: string) => string;
}) {
  const client = getClient(clientId);
  if (!client) return null;

  const [docs, qbEstimates] = await Promise.all([
    listDocuments(clientId, { clientVisibleOnly: true }),
    qbEstimatesForClient(clientId, client.email).catch(() => [] as QbEstimate[]),
  ]);
  const firstPdf = docHref ? docs.find((d) => d.mime === "application/pdf") : undefined;
  const webEstimate = db().requests
    .filter((r) => r.clientId === clientId && r.estimateLowCents)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const prop = propertyFor(clientId);
  const jobs = jobsFor(clientId);
  const invoices = invoicesFor(clientId);
  const quote = portalQuote(clientId);
  const job = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const nextVisit = job ? nextVisitFor(job.id) : undefined;
  const balance = invoices.reduce((s, i) => s + (i.totalCents - i.amountPaidCents), 0);
  const installed = Boolean(job && ["completed", "invoiced", "closed"].includes(job.status));

  const assessment = upcomingAssessment(clientId);
  const assessed = Boolean(completedAssessment(clientId));
  // The estimate that matters: the newest open one, else the newest accepted.
  const openEstimates = qbEstimates.filter((e) => !e.acceptedAt && !["Closed", "Rejected", "Converted"].includes(e.txnStatus ?? ""));
  const accepted = qbEstimates.find((e) => e.acceptedAt || e.txnStatus === "Accepted");
  const primaryEstimate = openEstimates[0] ?? accepted;
  const quoteAccepted = Boolean(accepted) || Boolean(quote && ["approved", "converted"].includes(quote.status));

  const journey = portalJourney(client, {
    assessmentBooked: assessment ? { when: shortDate(assessment.scheduledStart) } : undefined,
    assessmentDone: assessed,
    estimate: primaryEstimate
      ? { total: money(primaryEstimate.totalCents, true), accepted: quoteAccepted }
      : quote && quote.status !== "draft"
        ? { total: money(quote.totalCents, true), accepted: quoteAccepted }
        : undefined,
    installBooked: nextVisit && nextVisit.kind === "install" ? { when: shortDate(nextVisit.scheduledStart) } : undefined,
    installed,
  });

  const showBooking = journey.applicable && journey.current === 0 && !assessed;
  const firstName = client.name.split(" ")[0];

  return (
    <PortalFrame>
      <h1 className="mt-8 font-display text-2xl font-bold text-ink sm:text-3xl">Hello {firstName}</h1>
      <p className="mt-1.5 text-sm text-ink-dim">
        Everything about your flood barrier project, in one place.
        {prop && <> {prop.address}, {prop.city}.</>}
      </p>

      <section className="panel mt-7 rounded-2xl p-5">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Where things stand</p>
        {journey.applicable ? (
          <ol className="grid gap-3 sm:grid-cols-3">
            {PORTAL_JOURNEY.map((label, i) => {
              const done = i < journey.current;
              const active = i === journey.current;
              return (
                <li key={label} className={`flex items-start gap-2.5 rounded-xl border p-3 ${active ? "border-teal/60 bg-teal/10" : done ? "border-good/30" : "border-line/60"}`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    done ? "bg-good/20 text-good ring-1 ring-good/40" : active ? "bg-teal text-white" : "bg-white/5 text-ink-faint ring-1 ring-line"
                  }`}>
                    {done ? <Icon name="check" size={12} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm ${active ? "font-semibold text-ink" : done ? "text-ink-dim" : "text-ink-faint"}`}>{label}</span>
                    {journey.captions[i] && <span className="block text-[11px] leading-snug text-ink-faint">{journey.captions[i]}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm leading-relaxed text-ink-dim">
            This project is not active right now. If you would like to pick it back up, call us on (727) 613-1415 or reply to any of our emails.
          </p>
        )}
      </section>

      {(showBooking || assessment) && !installed && (
        <PortalBooking
          token={token}
          days={showBooking && !assessment ? availableSlots() : []}
          needsAddress={!prop}
          booked={assessment ? {
            visitId: assessment.id,
            when: `${longDate(assessment.scheduledStart)}, ${timeRange(assessment.scheduledStart, assessment.scheduledEnd)}`,
            where: prop ? `${prop.address}, ${prop.city}` : undefined,
          } : undefined}
        />
      )}

      {nextVisit && nextVisit.kind !== "assessment" && (
        <section className="panel mt-4 rounded-2xl border-line-bright p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-teal">Your next appointment</p>
          <p className="mt-2 font-display text-lg font-bold text-ink">{longDate(nextVisit.scheduledStart)}</p>
          <p className="text-sm text-ink-dim">{timeRange(nextVisit.scheduledStart, nextVisit.scheduledEnd)} · {nextVisit.title}</p>
          <p className="mt-3 text-xs text-ink-faint">
            We&apos;ll text you when the crew is on the way. Need to move it? Reply to any of our messages and we&apos;ll sort it.
          </p>
        </section>
      )}

      {qbEstimates.length > 0 && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your itemized estimate{qbEstimates.length > 1 ? "s" : ""}</p>
          <div className="mt-3 flex flex-col gap-3">
            {qbEstimates.map((e) => <EstimateCard key={e.id} estimate={e} href={estimateHref?.(e.id)} />)}
          </div>
          {qbEstimates.length > 1 && (
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Emma prepared more than one option so you can compare protection heights and series. Accept the one you want; the others close on their own.
            </p>
          )}
        </section>
      )}

      {!quote && !qbEstimates.length && webEstimate && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your online estimate</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-teal">{money(webEstimate.estimateLowCents!)} – {money(webEstimate.estimateHighCents ?? 0)}</p>
          <p className="mt-1 text-sm text-ink-dim">{webEstimate.title}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            This is the range you priced on thehydrodam.com on {shortDate(webEstimate.createdAt)}. Once we measure your openings you get an itemized estimate here, with every door and panel listed.
          </p>
        </section>
      )}

      {docs.length > 0 && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your documents</p>
          {firstPdf && (
            <div className="mt-3 overflow-hidden rounded-xl border border-line bg-black/30">
              <iframe src={docHref!(firstPdf.id)} title={firstPdf.title} className="h-[70vh] w-full" />
            </div>
          )}
          <ul className="mt-3 flex flex-col gap-1.5">
            {docs.map((d) => (
              <li key={d.id}>
                {docHref ? (
                  <a href={docHref(d.id)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line/60 p-3 transition-colors hover:border-line-bright">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/15 text-teal"><Icon name={d.mime.startsWith("image/") ? "camera" : "file"} size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{d.title}</span>
                      <span className="block text-xs text-ink-faint">{DOC_KINDS[d.kind] ?? "Document"} · {shortDate(d.created_at)}</span>
                    </span>
                    <Icon name="external" size={14} className="shrink-0 text-ink-faint" />
                  </a>
                ) : (
                  <span className="flex items-center gap-3 rounded-xl border border-line/60 p-3 opacity-80">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/15 text-teal"><Icon name="file" size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{d.title}</span>
                      <span className="block text-xs text-ink-faint">{DOC_KINDS[d.kind] ?? "Document"} · {shortDate(d.created_at)} · opens on the customer&apos;s own link</span>
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
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
              <Link href={approveHref} className="mt-4 block w-full rounded-xl bg-teal py-3.5 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90">
                Review and approve
              </Link>
            ) : (
              <p className="mt-4 block w-full rounded-xl bg-teal/40 py-3.5 text-center text-sm font-semibold text-white/70">Review and approve</p>
            )
          ) : (
            <p className="mt-4 rounded-xl border border-line/60 px-3 py-2.5 text-xs leading-relaxed text-ink-dim">
              This quote is {quote.status} and can no longer be approved online. Get in touch and HydroDam will send a fresh one.
            </p>
          )}
        </section>
      )}

      {balance > 0 && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Balance due</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-ink">{money(balance, true)}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            HydroDam will send payment details with your invoice. Bank transfer is preferred and carries no fee; a card payment carries a processing fee on an amount this size.
          </p>
        </section>
      )}

      {installed && (
        <section className="panel mt-4 rounded-2xl p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">After the install</p>
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
          {job?.warrantyEndsOn && <p className="mt-3 text-xs text-ink-faint">Your warranty runs to {shortDate(job.warrantyEndsOn)}.</p>}
        </section>
      )}

      <p className="mt-6 text-center text-[11px] text-ink-faint">This page is private to you. Please don&apos;t forward the link.</p>
    </PortalFrame>
  );
}

function EstimateCard({ estimate: e, href }: { estimate: QbEstimate; href?: string }) {
  const accepted = Boolean(e.acceptedAt) || e.txnStatus === "Accepted";
  const closed = !accepted && ["Closed", "Rejected", "Converted"].includes(e.txnStatus ?? "");
  const title = e.lines[0]?.name ? e.lines.map((l) => l.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 2).join(" + ") : "Itemized estimate";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{e.docNumber ? `Estimate #${e.docNumber}` : "Estimate"} · {title}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {e.txnDate ? shortDate(e.txnDate) : ""}{e.expirationDate && !accepted ? ` · valid to ${shortDate(e.expirationDate)}` : ""} · {e.lines.length} line{e.lines.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-base font-bold tabular-nums text-teal">{money(e.totalCents, true)}</p>
          <Badge tone={accepted ? "good" : closed ? "neutral" : "teal"}>{accepted ? "Accepted" : closed ? e.txnStatus : "Ready to review"}</Badge>
        </div>
      </div>
      {href && !closed && (
        <p className={`mt-3 text-center text-xs font-semibold ${accepted ? "text-ink-dim" : "text-teal"}`}>
          {accepted ? "View estimate and PDF" : "Review, accept and sign"} <Icon name="arrowRight" size={12} className="inline" />
        </p>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-line/60 p-4 transition-colors hover:border-line-bright">{body}</Link>
  ) : (
    <div className="rounded-xl border border-line/60 p-4 opacity-90">{body}</div>
  );
}
