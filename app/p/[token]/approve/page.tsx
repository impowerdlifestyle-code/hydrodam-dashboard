import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PortalApproval } from "@/components/PortalApproval";
import {
  ACKNOWLEDGMENT, AGREEMENT_VERSION, ESIGN_CONSENT, SMS_CONSENT, TERMS_OF_SALE, WARRANTY, type Clause,
} from "@/lib/agreement";
import { DB_LIVE, db, ensureData, getClient, getQuote, isApprovable, portalQuote } from "@/lib/db";
import { money, shortDate } from "@/lib/format";
import { resolvePortalToken } from "@/lib/portal";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review and approve · HydroDam",
  robots: { index: false, follow: false },
};

function Clauses({ title, clauses }: { title: string; clauses: Clause[] }) {
  return (
    <section className="panel mt-4 rounded-2xl p-5">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">
        {clauses.map((c) => (
          <div key={c.heading}>
            <h3 className="font-display text-sm font-semibold text-teal">{c.heading}</h3>
            {c.body.map((p, i) => (
              <p key={i} className="mt-1.5 text-sm leading-relaxed text-ink-dim">{p}</p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function PortalApprovePage({ params }: { params: Promise<{ token: string }> }) {
  await ensureData();
  const { token } = await params;

  const clientId = await resolveClient(token);
  if (!clientId) notFound();

  // portalQuote is the same rule the portal page renders from. When these were
  // two separate expressions, this page presented and signed a different quote
  // than the one the customer had just been looking at.
  const quote = portalQuote(clientId);
  if (!quote) notFound();

  const client = getClient(clientId);
  const prop = db().properties.find((p) => p.id === quote.propertyId);
  const signed = ["approved", "converted"].includes(quote.status);
  const closed = !signed && !isApprovable(quote);

  return (
    <>
      <Link href={`/p/${token}`} className="mb-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-teal">
        <Icon name="chevronLeft" size={12} /> Your project
      </Link>

      <h1 className="font-display text-2xl font-bold text-ink">Review and approve</h1>
      <p className="mt-1 text-sm text-ink-dim">
        Quote #{quote.number} · {money(quote.totalCents, true)} · valid to {shortDate(quote.validUntil)}
      </p>

      <section className="panel mt-5 rounded-2xl p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">What you are approving</p>
        <p className="mt-1.5 text-sm text-ink">{quote.title}</p>
        {prop && <p className="text-sm text-ink-dim">{prop.address}, {prop.city} {prop.postalCode}</p>}

        <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {quote.openings.map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink">{o.label}</span>
                <span className="block font-mono text-[11px] text-ink-faint">
                  {o.widthIn}&quot; × {o.protectionHeightIn}&quot; · {o.panelCount} planks · {o.postCount} posts
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-ink-dim">{money(o.lineTotalCents, true)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-dim">Total</dt>
            <dd className="font-mono tabular-nums text-teal">{money(quote.totalCents, true)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-dim">Deposit on approval</dt>
            <dd className="font-mono tabular-nums text-ink">{money(quote.depositDueCents, true)}</dd>
          </div>
        </dl>
      </section>

      <Clauses title="5-Year Limited Warranty" clauses={WARRANTY} />
      <Clauses title="Terms of Sale" clauses={TERMS_OF_SALE} />

      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        Agreement version {AGREEMENT_VERSION}
      </p>

      {closed ? (
        <div className="mt-6 rounded-2xl border border-line p-5">
          <p className="text-sm leading-relaxed text-ink-dim">
            This quote is {quote.status} and can no longer be approved online. Get in touch and
            HydroDam will send a fresh one.
          </p>
        </div>
      ) : signed ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-good/30 bg-good/10 p-5">
          <span className="mt-0.5 shrink-0 text-good"><Icon name="check" size={18} /></span>
          <p className="text-sm leading-relaxed text-good">
            Approved{quote.approvedByName ? ` by ${quote.approvedByName}` : ""} on{" "}
            {shortDate(quote.approvedAt)}. Nothing further is needed from you.
          </p>
        </div>
      ) : (
        <PortalApproval
          token={token}
          quoteId={quote.id}
          consentText={ESIGN_CONSENT}
          smsConsentText={SMS_CONSENT}
          acknowledgment={ACKNOWLEDGMENT}
          suggestedName={client?.name ?? ""}
        />
      )}
    </>
  );
}

async function resolveClient(token: string): Promise<string | null> {
  if (DB_LIVE) {
    const head = await headers();
    const link = await resolvePortalToken(token, {
      ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: head.get("user-agent") ?? undefined,
      path: "/p/approve",
    });
    return link?.clientId ?? null;
  }
  const seededId = token.replace(/^demo-/, "");
  return getQuote(seededId)?.clientId ?? db().clients.find((c) => c.id === seededId)?.id ?? null;
}
