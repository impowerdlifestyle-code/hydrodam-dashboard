import Link from "next/link";
import { Badge, EmptyState, RowLink, Table, Td, Th } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { reasonText, type Attempt, type Delivery, type OutboxRow } from "@/lib/outbox";

const DELIVERY_TONE: Record<Delivery, "neutral" | "teal" | "good" | "bad"> = {
  queued: "neutral",
  sent: "teal",
  delivered: "good",
  failed: "bad",
};

const ATTEMPT_TONE = { sent: "good", suppressed: "warn", failed: "bad", reserved: "neutral" } as const;
const ATTEMPT_LABEL = { sent: "sent", suppressed: "not sent", failed: "failed", reserved: "sending" } as const;

/** One line until opened, then the whole text. Hovering shows it too. */
function Body({ text }: { text: string }) {
  if (!text) return <span className="text-xs text-ink-faint">None</span>;
  return (
    <details className="group max-w-[360px]" title={text}>
      <summary className="cursor-pointer list-none truncate text-xs text-ink-dim group-open:hidden">{text}</summary>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{text}</p>
    </details>
  );
}

function When({ at }: { at: string }) {
  return (
    <>
      <span className="block text-xs text-ink">{dateTime(at)}</span>
      <span className="font-mono text-[10px] text-ink-faint">{relative(at)}</span>
    </>
  );
}

function ClientCell({ id, name }: { id?: string; name: string }) {
  return id ? <RowLink href={`/texts/${id}`}><span className="text-sm font-semibold">{name}</span></RowLink> : <span className="text-sm">{name}</span>;
}

function DeliveryCell({ delivery, error }: { delivery: Delivery; error?: string }) {
  return (
    <>
      <Badge tone={DELIVERY_TONE[delivery]}>{delivery}</Badge>
      {error && <span className="mt-1 block text-[11px] text-bad">{error}</span>}
    </>
  );
}

export function SentTable({ rows, empty }: { rows: OutboxRow[]; empty: string }) {
  if (!rows.length) return <EmptyState icon="send" title={empty} />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Client</Th>
          <Th>Message</Th>
          <Th align="center">Source</Th>
          <Th align="center">Segments</Th>
          <Th align="center">Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="align-top text-ink-dim">
            <Td className="whitespace-nowrap"><When at={r.at} /></Td>
            <Td><ClientCell id={r.clientId} name={r.clientName} /></Td>
            <Td><Body text={r.body} /></Td>
            <Td align="center" className="text-xs">{r.source.label}</Td>
            <Td align="center" className="font-mono text-xs tabular-nums">{r.segments}</Td>
            <Td align="center"><DeliveryCell delivery={r.delivery} error={r.error} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function AttemptsTable({ rows, empty }: { rows: Attempt[]; empty: string }) {
  if (!rows.length) return <EmptyState icon="flow" title={empty} />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Automation</Th>
          <Th>Client</Th>
          <Th>Message</Th>
          <Th align="center">Segments</Th>
          <Th align="center">Outcome</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="align-top text-ink-dim">
            <Td className="whitespace-nowrap"><When at={r.at} /></Td>
            <Td className="text-xs text-ink">{r.automationName}</Td>
            <Td><ClientCell id={r.clientId} name={r.clientName} /></Td>
            <Td>
              {r.message ? <Body text={r.message.body} /> : (
                <span className="text-xs text-ink-faint">{r.status === "sent" ? "Sent, text not linked" : "Not sent"}</span>
              )}
            </Td>
            <Td align="center" className="font-mono text-xs tabular-nums">{r.message?.segments ?? "None"}</Td>
            <Td align="center">
              <Badge tone={ATTEMPT_TONE[r.status]}>{ATTEMPT_LABEL[r.status]}</Badge>
              {r.reason && <span className={`mt-1 block text-[11px] ${r.status === "failed" ? "text-bad" : "text-warn"}`}>{reasonText(r.status, r.reason)}</span>}
              {r.message && <span className="mt-1 block"><DeliveryCell delivery={r.message.delivery} error={r.message.error} /></span>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function FilterPills({ label, options }: { label: string; options: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</span>
      {options.map((o) => (
        <Link
          key={o.href + o.label}
          href={o.href}
          scroll={false}
          className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            o.active ? "bg-teal/15 text-teal ring-1 ring-line-bright" : "text-ink-faint ring-1 ring-line/60 hover:text-ink"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Pager({ page, pages, total, pageSize, href }: { page: number; pages: number; total: number; pageSize: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-xs text-ink-faint">
      <span className="font-mono">
        {((page - 1) * pageSize + 1).toLocaleString()} to {Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}
      </span>
      <span className="flex gap-2">
        {page > 1 && <Link href={href(page - 1)} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">Previous</Link>}
        {page < pages && <Link href={href(page + 1)} className="rounded-full px-3 py-1 ring-1 ring-line hover:text-ink">Next</Link>}
      </span>
    </nav>
  );
}
