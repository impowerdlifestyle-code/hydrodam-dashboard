import { Badge, EmptyState, Panel, SectionLabel } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relative, shortDate } from "@/lib/format";
import { toE164 } from "@/lib/telnyx";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import type { Client } from "@/lib/types";

type Row = {
  id: string;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  status: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  from_address: string;
  to_address: string;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quoted = (v: string) => `"${v.replace(/"/g, "")}"`;

/**
 * Every email and text on record for this client, both directions, newest
 * first. Matched on client_id and also on their address, because a HubSpot
 * lead that was never promoted has no Postgres id and older rows were written
 * without one.
 */
async function history(client: Client): Promise<Row[]> {
  if (!SUPABASE_LIVE) return [];
  const match: string[] = [];
  if (UUID.test(client.id)) match.push(`client_id.eq.${client.id}`);
  if (client.email) {
    const e = quoted(client.email.trim().toLowerCase());
    match.push(`to_address.ilike.${e}`, `from_address.ilike.${e}`);
  }
  if (client.phone) {
    const ph = quoted(toE164(client.phone));
    match.push(`to_address.eq.${ph}`, `from_address.eq.${ph}`);
  }
  if (!match.length) return [];
  return pg.select<Row>("messages", {
    select: "id,channel,direction,status,subject,body_text,body_html,from_address,to_address,created_at",
    or: `(${match.join(",")})`,
    order: "created_at.desc",
    limit: "200",
  });
}

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  delivered: "good", received: "good", sent: "neutral", queued: "warn", sending: "warn", failed: "bad", bounced: "bad",
};

export async function Correspondence({ client }: { client: Client }) {
  const rows = await history(client).catch((err) => {
    console.warn("[correspondence] load failed", err);
    return null;
  });
  const emails = rows?.filter((r) => r.channel === "email").length ?? 0;
  const texts = rows?.filter((r) => r.channel === "sms").length ?? 0;

  return (
    <Panel>
      <SectionLabel action={rows?.length ? <span className="font-mono text-[10px] text-ink-faint">{emails} {emails === 1 ? "email" : "emails"} · {texts} {texts === 1 ? "text" : "texts"}</span> : undefined}>
        Correspondence history
      </SectionLabel>
      {rows === null ? (
        <p className="text-sm text-bad">Could not load the history. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="mail" title="Nothing sent yet" body="Emails and texts to or from this client will show here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => {
            const inbound = m.direction === "inbound";
            const preview = m.channel === "email" ? (m.subject ?? "(no subject)") : (m.body_text ?? "");
            return (
              <li key={m.id}>
                <details className="group rounded-xl border border-line bg-white/[0.02] open:bg-white/[0.04]">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${inbound ? "bg-ember/15 text-ember" : "bg-teal/15 text-teal"}`}>
                      <Icon name={m.channel === "email" ? "mail" : "phone"} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{preview}</span>
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        {m.channel === "email" ? "Email" : "Text"} · {inbound ? "from" : "to"} <span className="normal-case">{inbound ? m.from_address : m.to_address}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-ink-dim" title={shortDate(m.created_at)}>{relative(m.created_at)}</span>
                      <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                    </span>
                  </summary>
                  <div className="border-t border-line px-4 py-3">
                    {m.channel === "email" && m.body_html ? (
                      <iframe
                        title={preview}
                        sandbox=""
                        srcDoc={m.body_html}
                        loading="lazy"
                        className="h-[480px] w-full rounded-lg bg-white"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-dim">{m.body_text || "(empty)"}</p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
