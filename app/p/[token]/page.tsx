import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PortalView } from "@/components/PortalView";
import { DB_LIVE, db, ensureData, getClient, getQuote } from "@/lib/db";
import { resolvePortalToken } from "@/lib/portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your HydroDam project", robots: { index: false, follow: false } };

/**
 * The token is the credential: an opaque random string whose sha256 is stored
 * with an expiry and a revocation flag, resolved in lib/portal.ts and logged
 * either way. It is never derived from a record id, so possessing a quote id
 * grants nothing.
 *
 * With no database configured there is nowhere to store a hash, so the seed
 * path falls back to resolving a seeded id — walkable locally, and unreachable
 * in production because DB_LIVE is true there.
 */
async function resolveToken(token: string): Promise<string | null> {
  if (DB_LIVE) {
    const head = await headers();
    const link = await resolvePortalToken(token, {
      ip: head.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: head.get("user-agent") ?? undefined,
      path: "/p",
    });
    return link?.clientId ?? null;
  }

  const seededId = token.replace(/^demo-/, "");
  return getQuote(seededId)?.clientId ?? db().clients.find((c) => c.id === seededId)?.id ?? null;
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!DB_LIVE) await ensureData();
  const clientId = await resolveToken(token);
  if (!clientId) notFound();

  // The cached snapshot is enough to show the page; booking re-checks the slot
  // against fresh rows. Only a client created since that snapshot, as happens
  // when minting a link promotes a HubSpot lead, forces a reload.
  await ensureData();
  if (!getClient(clientId)) await ensureData({ fresh: true });

  return (
    <PortalView
      clientId={clientId}
      token={token}
      approveHref={`/p/${token}/approve`}
      docHref={(id) => `/p/${token}/doc/${id}`}
      estimateHref={(id) => `/p/${token}/estimate/${id}`}
    />
  );
}
