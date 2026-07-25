import { PageHeader, Panel, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";

// Inbox surfaces HubSpot Conversations once the inbox scope is granted on the
// Private App. Until then this shows the shape with representative threads.
const THREADS = [
  { id: "1", from: "David Stern", subject: "Re: Storefront quote — can we expedite?", preview: "We'd like to move before the next system…", when: "12m", unread: true, channel: "email" },
  { id: "2", from: "Tammy White", subject: "Install scheduling", preview: "Thursday works great for us, thank you!", when: "1h", unread: true, channel: "email" },
  { id: "3", from: "(727) 555-0142", subject: "SMS", preview: "Is the assessment still free?", when: "2h", unread: false, channel: "sms" },
  { id: "4", from: "Jennifer Park", subject: "Re: Onyx vs Sentinel", preview: "Does the black finish cost more?", when: "5h", unread: false, channel: "email" },
];

export default function InboxPage() {
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Unified email & SMS from HubSpot Conversations."
        action={<Badge tone="warn"><span className="h-1.5 w-1.5 rounded-full bg-current" />Preview — grant Conversations scope</Badge>}
      />
      <Panel className="p-0">
        <div className="divide-y divide-line">
          {THREADS.map((t) => (
            <div key={t.id} className="flex items-start gap-4 p-4 transition-colors hover:bg-white/5">
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.unread ? "bg-teal/15 text-teal" : "bg-white/5 text-ink-faint"}`}>
                <Icon name={t.channel === "sms" ? "phone" : "mail"} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className={`truncate text-sm ${t.unread ? "font-semibold text-ink" : "text-ink-dim"}`}>{t.from}</p>
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">{t.when}</span>
                </div>
                <p className="truncate text-sm text-ink">{t.subject}</p>
                <p className="truncate text-xs text-ink-faint">{t.preview}</p>
              </div>
              {t.unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal" />}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
