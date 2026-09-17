import Link from "next/link";
import { Badge, EmptyState, KeyValue, LinkButton, PageHeader, Panel, SectionLabel, Table, Td, Th, buttonClass } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { money, relative, shortDate } from "@/lib/format";
import { QB_CONFIGURED, qbConnection } from "@/lib/quickbooks";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import { syncNowAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "QuickBooks · HydroDam Ops" };

type Row = {
  id: string;
  doc_number: string | null;
  txn_date: string | null;
  customer_name: string | null;
  customer_email: string | null;
  total_cents: number;
  txn_status: string | null;
  client_id: string | null;
  clients: { id: string; display_name: string } | null;
};

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad" | "teal"> = {
  Pending: "teal", Accepted: "good", Closed: "neutral", Rejected: "bad", Converted: "good",
};

const ERROR_TEXT: Record<string, string> = {
  not_configured: "QuickBooks is not configured yet. Add the three env vars below and redeploy.",
  state: "The sign-in did not match the request that started it. Start again from Connect QuickBooks.",
  missing_code: "Intuit came back without an authorization code. Start again from Connect QuickBooks.",
  access_denied: "The connection was declined on the Intuit side.",
};

export default async function QuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
}) {
  const { connected, disconnected, error } = await searchParams;
  const conn = QB_CONFIGURED ? await qbConnection() : null;
  const rows =
    conn && SUPABASE_LIVE
      ? await pg.select<Row>("quickbooks_estimates", {
          select: "id,doc_number,txn_date,customer_name,customer_email,total_cents,txn_status,client_id,clients(id,display_name)",
          order: "txn_date.desc.nullslast,synced_at.desc",
          limit: "100",
        })
      : [];

  return (
    <>
      <PageHeader
        title="QuickBooks"
        subtitle="Mady's estimates, cached here so the client portal can show and accept them."
      />

      {connected && <Banner tone="good" text="QuickBooks is connected and the first sync has run." />}
      {disconnected && <Banner tone="neutral" text="QuickBooks has been disconnected. The cached estimates stay until the next connection replaces them." />}
      {error && <Banner tone="bad" text={ERROR_TEXT[error] ?? `Connection failed: ${error}`} />}

      {!QB_CONFIGURED ? (
        <Panel>
          <SectionLabel>Not configured</SectionLabel>
          <p className="text-sm text-ink-dim">The app needs an Intuit app of its own before anyone can connect. Four steps:</p>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-dim">
            <li>Create an app at <span className="font-mono text-ink">developer.intuit.com</span> with the Accounting scope.</li>
            <li>
              On the app&apos;s <span className="text-ink">Production keys</span> tab under Settings, register this exact redirect URI:{" "}
              <span className="font-mono text-ink">{process.env.QB_REDIRECT_URI ?? `${process.env.PORTAL_BASE_URL ?? "https://hydrodam-dashboard.vercel.app"}/api/quickbooks/callback`}</span>
            </li>
            <li>
              Paste the keys into Vercel as <span className="font-mono text-ink">QB_CLIENT_ID</span> and{" "}
              <span className="font-mono text-ink">QB_CLIENT_SECRET</span>. Set{" "}
              <span className="font-mono text-ink">QB_ENVIRONMENT</span> to <span className="font-mono text-ink">production</span> (or <span className="font-mono text-ink">sandbox</span> to test).
            </li>
            <li>Redeploy, then come back here and click Connect QuickBooks.</li>
          </ol>
        </Panel>
      ) : !conn ? (
        <Panel>
          <SectionLabel>Not connected</SectionLabel>
          <EmptyState
            icon="link"
            title="Connect the HydroDam QuickBooks company"
            body="Mady is the QuickBooks admin, so she has to be the one signed in to Intuit when she clicks this. The grant lasts until it is disconnected here or revoked in QuickBooks."
            action={<LinkButton href="/api/quickbooks/connect" icon="link">Connect QuickBooks</LinkButton>}
          />
        </Panel>
      ) : (
        <Panel>
          <SectionLabel
            action={
              <div className="flex items-center gap-2">
                <form action={syncNowAction}>
                  <button type="submit" className={buttonClass("secondary", "sm")}>
                    <Icon name="refresh" size={14} />
                    Sync now
                  </button>
                </form>
                <form method="post" action="/api/quickbooks/disconnect">
                  <button type="submit" className={buttonClass("outline", "sm")}>
                    Disconnect
                  </button>
                </form>
              </div>
            }
          >
            Connection
          </SectionLabel>
          <KeyValue
            rows={[
              ["Realm", <span key="realm" className="font-mono">{conn.realmId}</span>],
              ["Environment", <Badge key="env" tone={conn.environment === "production" ? "good" : "warn"}>{conn.environment}</Badge>],
              ["Connected", `${shortDate(conn.connectedAt)}${conn.connectedBy ? ` by ${conn.connectedBy}` : ""}`],
              ["Last sync", conn.lastSyncAt ? relative(conn.lastSyncAt) : "never"],
              [
                "Last error",
                conn.lastSyncError
                  ? <span key="err" className="text-bad">{conn.lastSyncError}</span>
                  : <span key="ok" className="text-good">none</span>,
              ],
              ["Schedule", "daily at 12:00 UTC (8am EDT), plus Sync now"],
            ]}
          />
        </Panel>
      )}

      {conn && (
        <Panel className="mt-6">
          <SectionLabel>Newest estimates</SectionLabel>
          {rows.length === 0 ? (
            <EmptyState
              icon="file"
              title="No estimates cached yet"
              body="Run Sync now. Estimates updated in QuickBooks since January 2024 will appear here."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Doc #</Th>
                  <Th>Date</Th>
                  <Th>Customer</Th>
                  <Th>Email</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th>Client</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="text-ink-dim">
                    <Td className="font-mono text-xs text-ink">{r.doc_number ?? r.id.slice(0, 8)}</Td>
                    <Td className="text-xs">{shortDate(r.txn_date ?? undefined)}</Td>
                    <Td className="text-sm text-ink">{r.customer_name ?? "Unnamed"}</Td>
                    <Td className="text-xs">{r.customer_email ?? <span className="text-ink-faint">none on file</span>}</Td>
                    <Td align="right" className="font-mono text-xs tabular-nums text-ink">{money(Number(r.total_cents), true)}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.txn_status ?? ""] ?? "neutral"}>{r.txn_status ?? "unknown"}</Badge>
                    </Td>
                    <Td className="text-xs">
                      {r.client_id && r.clients ? (
                        <Link href={`/clients/${r.client_id}`} className="text-ink transition-colors hover:text-teal">
                          {r.clients.display_name}
                        </Link>
                      ) : (
                        <span className="text-warn">no client match</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}
    </>
  );
}

function Banner({ tone, text }: { tone: "good" | "neutral" | "bad"; text: string }) {
  const cls = {
    good: "border-good/30 bg-good/[0.06] text-good",
    neutral: "border-line bg-white/[0.03] text-ink-dim",
    bad: "border-bad/30 bg-bad/[0.06] text-bad",
  }[tone];
  return (
    <div className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 ${cls}`}>
      <span className="mt-0.5 shrink-0"><Icon name={tone === "bad" ? "alert" : "check"} size={16} /></span>
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}
