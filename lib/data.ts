export const NAV = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/crm", label: "CRM", icon: "users" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/inbox", label: "Inbox", icon: "mail" },
  { href: "/workflows", label: "Workflows", icon: "flow" },
  { href: "/sops", label: "SOPs", icon: "book" },
  { href: "/copilot", label: "AI Copilot", icon: "spark" },
] as const;

export type Sop = { id: string; title: string; category: string; updated: string; steps: string[] };

export const SOPS: Sop[] = [
  {
    id: "lead-intake",
    title: "New Lead Intake & Speed-to-Lead",
    category: "Sales",
    updated: "Jun 2026",
    steps: [
      "Every new lead (form, call, ad, chat) lands in HubSpot as a Contact + open Deal.",
      "Respond within 5 minutes — call first, then text/email if no answer.",
      "Qualify: openings to protect, flood zone, timeline, decision-maker.",
      "Book the free in-home assessment on the calendar; set the Deal to 'Assessment booked'.",
    ],
  },
  {
    id: "assessment",
    title: "In-Home Assessment & Quote",
    category: "Sales",
    updated: "Jun 2026",
    steps: [
      "Arrive on time; measure every ground-level opening (width × height).",
      "Photograph each opening and note flood zone / water history.",
      "Recommend the right series (Sentinel / Onyx / Titanium) and stack height.",
      "Build the quote in HubSpot, present the range, and move Deal to 'Quoted'.",
    ],
  },
  {
    id: "fabrication",
    title: "Fabrication & Install Scheduling",
    category: "Operations",
    updated: "Jun 2026",
    steps: [
      "On signed contract + deposit, generate the cut sheet from measurements.",
      "Fabricate barriers and posts to spec; QC the gasket seal.",
      "Schedule install; confirm 24h prior. Mount U-channel posts.",
      "Walk the customer through deployment; collect balance; mark Deal 'Won'.",
    ],
  },
  {
    id: "review-engine",
    title: "Review & Referral Engine",
    category: "Marketing",
    updated: "Jun 2026",
    steps: [
      "Day of install: ask for a Google review, send the review link by text.",
      "Day 3: follow-up thank-you + referral ask.",
      "Log the review; respond to every review within 24h.",
      "Tag happy customers for the seasonal re-engagement campaign.",
    ],
  },
  {
    id: "storm-protocol",
    title: "Storm-Watch Surge Protocol",
    category: "Operations",
    updated: "Jun 2026",
    steps: [
      "When NHC flags an Atlantic system, trigger the storm-watch banner + ad push.",
      "Prioritize already-quoted deals; offer expedited install slots.",
      "Staff up install crews; confirm material stock for top sellers.",
      "Post daily updates to Google Profile + Instagram until landfall.",
    ],
  },
];

export type Workflow = { id: string; name: string; trigger: string; status: "live" | "draft" | "paused"; steps: string[] };

export const WORKFLOWS: Workflow[] = [
  {
    id: "speed-to-lead",
    name: "Speed-to-Lead Auto-Response",
    trigger: "New contact created",
    status: "live",
    steps: ["Instant SMS + email reply", "Create follow-up task for rep", "Start 5-touch nurture if no reply in 24h"],
  },
  {
    id: "assessment-reminders",
    name: "Assessment Reminders",
    trigger: "Assessment booked",
    status: "live",
    steps: ["Confirmation email + calendar invite", "24h SMS reminder", "2h SMS reminder"],
  },
  {
    id: "quote-followup",
    name: "Quote Follow-Up Sequence",
    trigger: "Deal → Quoted",
    status: "live",
    steps: ["Day 1 recap email", "Day 3 check-in call task", "Day 7 storm-season urgency email"],
  },
  {
    id: "review-request",
    name: "Review Request",
    trigger: "Deal → Won",
    status: "live",
    steps: ["Same-day Google review SMS", "Day 3 referral ask", "Tag for re-engagement"],
  },
  {
    id: "dormant-revive",
    name: "Dormant Quote Revival",
    trigger: "Quoted + no activity 30d",
    status: "draft",
    steps: ["Win-back email with seasonal offer", "Rep call task", "Re-quote if needed"],
  },
];

export const CAL_LINK = "team/the-hydro-dam-team/free-home-assessment";
