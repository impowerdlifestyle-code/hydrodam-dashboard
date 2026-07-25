import { PageHeader, Panel } from "@/components/ui";
import { CAL_LINK } from "@/lib/data";

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" subtitle="Assessment bookings and team scheduling." />
      <Panel className="overflow-hidden p-0">
        <iframe
          title="HydroDam booking calendar"
          src={`https://cal.com/${CAL_LINK}?embed=true&theme=dark`}
          className="h-[78vh] w-full"
          loading="lazy"
        />
      </Panel>
      <p className="mt-4 text-center text-xs text-ink-faint">
        Live Cal.com event · the same one wired into the website&apos;s &quot;Schedule a free home assessment&quot; buttons.
      </p>
    </>
  );
}
