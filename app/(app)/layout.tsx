import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { db, metrics } from "@/lib/db";

export default function AppLayout({ children }: { children: ReactNode }) {
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
