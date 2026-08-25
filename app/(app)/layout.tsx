import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { db, ensureData, metrics } from "@/lib/db";

// The layout renders alongside the page, not after it, so it cannot rely on
// the page's own ensureData() having landed. Without this await a cold lambda
// painted the sidebar counts straight off lib/seed.ts — seeded jobs, invoices
// and unread threads, in production, on the first request after every deploy.
export default async function AppLayout({ children }: { children: ReactNode }) {
  await ensureData();
  const m = metrics();
  const badges: Record<string, number> = {
    "/requests": m.unassignedRequests,
    "/inbox": m.unreadMessages,
    "/invoices": m.overdueCount,
    "/schedule": db().visits.filter((v) => v.status === "unscheduled").length,
  };
  return (
    <div className="lg:flex">
      <Sidebar badges={badges} />
      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  );
}
