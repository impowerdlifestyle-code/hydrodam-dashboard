import type { Role } from "@/lib/types";

/**
 * The Overview is assembled from named panels. The Build Agent can reorder,
 * add or drop them per role, and this registry is the whole vocabulary it is
 * allowed to use, so a layout can never reference a panel that does not exist.
 */
export const PANELS = {
  stats: "Headline numbers: pipeline, won, outstanding, active jobs",
  today: "Today on the board: every visit scheduled today with crew and status",
  attention: "Needs you: new requests, unread messages, overdue invoices, unscheduled visits",
  queue: "My queue: the requests assigned to whoever is looking, grouped by status",
  requests: "Newest requests from the website and HubSpot",
  inbox: "Latest text and email threads",
  crew: "Who is on the clock and what each crew member has today",
  checklists: "Checklists and SOPs built for this role",
  revenue: "Booked vs collected, last six months",
  pipeline: "Quote pipeline by stage, average ticket, collected this month",
  campaigns: "Text campaigns: audience size and the last sends",
} as const;

export type PanelKey = keyof typeof PANELS;

export const DEFAULT_LAYOUTS: Record<Role, PanelKey[]> = {
  owner: ["stats", "today", "attention", "revenue", "pipeline"],
  office: ["queue", "attention", "today", "requests", "inbox", "checklists", "campaigns"],
  crew: ["today", "crew", "checklists"],
};
