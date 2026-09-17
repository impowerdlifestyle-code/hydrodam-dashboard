import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PortalAcceptance } from "@/components/PortalAcceptance";
import { PortalFrame } from "@/components/PortalFrame";
import { Badge } from "@/components/ui";
import { ACKNOWLEDGMENT, AGREEMENT_VERSION, ESIGN_CONSENT, SMS_CONSENT, TERMS_OF_SALE, WARRANTY, type Clause } from "@/lib/agreement";
import { DB_LIVE, ensureData, getClient, propertyFor } from "@/lib/db";
import { money, shortDate } from "@/lib/format";
import { resolvePortalToken } from "@/lib/portal";
import { qbEstimateById } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your estimate · HydroDam", robots: { index: false, follow: false } };

function Clauses({ title, clauses }: { title: string; clauses: Clause[] }) {
  return (
    <section className="panel mt-4 rounded-2xl p-5">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">
        {clauses.map((c) => (
          <div key={c.heading}>
            <h3 className="font-display text-sm font-semibold text-teal">{c.heading}</h3>
            {c.body.map((para, i) => <p key={i} className="mt-1.5 text-sm leading-relaxed text-ink-dim">{para}</p>)}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function PortalEstimatePage({ params }: { params: Promise<{ token: string; id: string }> }) {
  if (!DB_LIVE) notFound();
  await ensureData();
  const { token, id } = await params;

  const head = await headers();
  const link = await resolvePortalToken(token, {
    ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: head.get("user-agent") ?? undefined,
    path: "/p/estimate",
  });
  if (!link) notFound();

  const client = getClient(link.clientId);
  const estimate = await qbEstimateById(id);
  const ownsIt =
    estimate &&
    (estimate.clientId === link.clientId ||
      (client?.email && estimate.customerEmail?.toLowerCase() === client.email.toLowerCase()));
  if (!estimate || !ownsIt) notFound();

  const prop = propertyFor(link.clientId);
  const accepted = Boolean(estimate.acceptedAt) || estimate.txnStatus === "Accepted";
  const closed = !accepted && ["Closed", "Rejected", "Converted"].includes(estimate.txnStatus ?? "");
  const pdfHref = `/p/${token}/estimate/${estimate.id}/pdf`;

  return (
    <PortalFrame>
      <Link href={`/p/${token}`} className="mt-6 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal">
        <Icon name="chevronLeft" size={12} /> Your project
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{accepted ? "Your accepted estimate" : "Review and accept"}</h1>
          <p className="mt-1 text-sm text-ink-dim">
            {estimate.docNumber ? `Estimate #${estimate.docNumber}` : "Estimate"}
            {estimate.txnDate ? ` · ${shortDate(estimate.txnDate)}` : ""}
            {estimate.expirationDate && !accepted ? ` · valid to ${shortDate(estimate.expirationDate)}` : ""}
          </p>
        </div>
        <Badge tone={accepted ? "good" : closed ? "neutral" : "teal"}>{accepted ? "Accepted" : closed ? estimate.txnStatus : "Pending"}</Badge>
      </div>

      <section className="panel mt-5 rounded-2xl p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">Itemized estimate</p>
        {prop && <p className="mt-1.5 text-sm text-ink-dim">{prop.address}, {prop.city} {prop.postalCode}</p>}

        <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {estimate.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block text-ink">{l.name}</span>
                {l.description && <span className="block text-xs leading-snug text-ink-faint">{l.description}</span>}
                <span className="block font-mono text-[11px] text-ink-faint">{l.quantity} × {money(l.rateCents, true)}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-ink-dim">{money(l.amountCents, true)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
          {estimate.subtotalCents > 0 && estimate.subtotalCents !== estimate.totalCents && (
            <div className="flex justify-between"><dt className="text-ink-dim">Subtotal</dt><dd className="font-mono tabular-nums text-ink">{money(estimate.subtotalCents, true)}</dd></div>
          )}
          {estimate.discountCents > 0 && (
            <div className="flex justify-between"><dt className="text-ink-dim">Discount</dt><dd className="font-mono tabular-nums text-good">−{money(estimate.discountCents, true)}</dd></div>
          )}
          {estimate.taxCents > 0 && (
            <div className="flex justify-between"><dt className="text-ink-dim">Tax</dt><dd className="font-mono tabular-nums text-ink">{money(estimate.taxCents, true)}</dd></div>
          )}
          <div className="flex justify-between font-display text-lg font-bold">
            <dt>Total</dt><dd className="font-mono tabular-nums text-teal">{money(estimate.totalCents, true)}</dd>
          </div>
        </dl>

        {estimate.memo && <p className="mt-4 whitespace-pre-line rounded-xl border border-line/60 px-3 py-2.5 text-xs leading-relaxed text-ink-dim">{estimate.memo}</p>}

        <a href={pdfHref} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-teal">
          <Icon name="download" size={13} /> Download the PDF from QuickBooks
        </a>
      </section>

      {!accepted && !closed && (
        <>
          <Clauses title="5-Year Limited Warranty" clauses={WARRANTY} />
          <Clauses title="Terms of Sale" clauses={TERMS_OF_SALE} />
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-ink-faint">Agreement version {AGREEMENT_VERSION}</p>
          <PortalAcceptance
            token={token}
            estimateId={estimate.id}
            consentText={ESIGN_CONSENT}
            smsConsentText={SMS_CONSENT}
            acknowledgment={ACKNOWLEDGMENT}
            suggestedName={client?.name ?? ""}
          />
        </>
      )}

      {accepted && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-good/30 bg-good/10 p-5">
          <span className="mt-0.5 shrink-0 text-good"><Icon name="check" size={18} /></span>
          <p className="text-sm leading-relaxed text-good">
            Accepted{estimate.acceptedBy ? ` by ${estimate.acceptedBy}` : ""}{estimate.acceptedAt ? ` on ${shortDate(estimate.acceptedAt)}` : ""}. HydroDam will be in touch to schedule your installation.
          </p>
        </div>
      )}

      {closed && (
        <div className="mt-6 rounded-2xl border border-line p-5">
          <p className="text-sm leading-relaxed text-ink-dim">This estimate is {estimate.txnStatus?.toLowerCase()} and can no longer be accepted online. Get in touch and HydroDam will send a fresh one.</p>
        </div>
      )}
    </PortalFrame>
  );
}
