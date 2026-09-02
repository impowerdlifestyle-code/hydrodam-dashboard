import { PageHeader, Panel, SectionLabel, StatCard } from "@/components/ui";
import { BuilderChat } from "@/components/BuilderChat";
import { BuiltItems } from "@/components/BuiltItems";
import { listItems, type AutomationSpec, type BuildRequestSpec, type ChecklistSpec, type LayoutSpec, type TemplateSpec } from "@/lib/builder";
import { currentStaff } from "@/lib/whoami";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builder · HydroDam Ops" };

function summarise(kind: string, spec: Record<string, unknown>): { summary: string; href?: string } {
  switch (kind) {
    case "template": { const s = spec as TemplateSpec; return { summary: s.body, href: "/inbox" }; }
    case "automation": { const s = spec as AutomationSpec; return { summary: `${s.trigger}, days [${s.offsets_days.join(", ")}], ${s.channels.join(" + ")}. ${s.sms ?? s.email_subject ?? ""}`, href: "/automations" }; }
    case "checklist": { const s = spec as ChecklistSpec; return { summary: `${s.steps.length} steps for the ${s.audience}: ${s.steps.slice(0, 4).map((x) => x.label).join(", ")}${s.steps.length > 4 ? "…" : ""}`, href: "/team" }; }
    case "layout": { const s = spec as LayoutSpec; return { summary: s.panels.join(" > "), href: "/" }; }
    case "build_request": { const s = spec as BuildRequestSpec; return { summary: `${s.summary}${s.emailed ? " (emailed to Voreli)" : " (not emailed)"}` }; }
    default: return { summary: "" };
  }
}

export default async function BuilderPage() {
  const [items, who] = await Promise.all([listItems(), currentStaff()]);
  const rows = items.map((i) => ({ id: i.id, kind: i.kind, key: i.key, name: i.name, status: i.status, created_by: i.created_by, created_at: i.created_at, ...summarise(i.kind, i.spec) }));
  const built = rows.filter((r) => r.kind !== "build_request");
  const requests = rows.filter((r) => r.kind === "build_request");

  return (
    <>
      <PageHeader title="Builder" subtitle="Describe what you need. It gets built here, or written up for the developer." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Built here" value={built.length} sub="templates, automations, checklists, layouts" accent="good" />
        <StatCard label="Build requests" value={requests.length} sub={`${requests.filter((r) => r.status !== "done").length} open with Voreli`} accent="ember" />
        <StatCard label="Building as" value={who?.name ?? "Not chosen"} sub={who ? who.role : "pick your name in the sidebar"} accent={who ? "teal" : "warn"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Panel className="p-0 lg:col-span-3">
          <BuilderChat />
        </Panel>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Panel>
            <SectionLabel>Built here</SectionLabel>
            <BuiltItems rows={built} />
          </Panel>
          <Panel>
            <SectionLabel>Sent to the developer</SectionLabel>
            <BuiltItems rows={requests} />
          </Panel>
        </div>
      </div>
    </>
  );
}
