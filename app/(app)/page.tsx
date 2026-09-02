import Link from "next/link";
import { ConnectionPill, PageHeader } from "@/components/ui";
import { FULL_WIDTH, renderPanel } from "@/components/overview/Panels";
import { DB_LIVE, ensureData } from "@/lib/db";
import { layoutFor } from "@/lib/builder";
import { currentRole, currentStaff } from "@/lib/whoami";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · HydroDam Ops" };

const SUBTITLE = {
  owner: "Everything moving through the business right now.",
  office: "What needs a reply, a booking or a follow-up today.",
  crew: "Where you are going and what to bring.",
} as const;

export default async function OverviewPage() {
  await ensureData();
  const [who, role] = await Promise.all([currentStaff(), currentRole()]);
  const layout = await layoutFor(role);

  const rows: (typeof layout)[] = [];
  for (const key of layout) {
    const last = rows[rows.length - 1];
    if (!FULL_WIDTH.includes(key) && last && last.length === 1 && !FULL_WIDTH.includes(last[0])) last.push(key);
    else rows.push([key]);
  }

  return (
    <>
      <PageHeader
        title={who ? `Good ${greeting()}, ${who.name.split(" ")[0]}` : "Overview"}
        subtitle={SUBTITLE[role]}
        action={
          <span className="flex items-center gap-3">
            <Link href="/builder" className="font-mono text-[11px] uppercase tracking-wider text-ink-faint hover:text-teal">{role} layout · change</Link>
            <ConnectionPill connected={DB_LIVE} />
          </span>
        }
      />
      <div className="flex flex-col gap-6">
        {rows.map((row) => (
          <div key={row.join("+")} className={row.length === 2 ? "grid gap-6 lg:grid-cols-2" : ""}>
            {row.map((key) => <div key={key}>{renderPanel(key, role)}</div>)}
          </div>
        ))}
      </div>
    </>
  );
}

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
