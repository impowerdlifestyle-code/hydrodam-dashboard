export const NAV = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/requests", label: "Requests", icon: "inbox" },
  { href: "/quotes", label: "Quotes", icon: "file" },
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/jobs", label: "Jobs", icon: "wrench" },
  { href: "/invoices", label: "Invoices", icon: "dollar" },
  { href: "/clients", label: "Clients", icon: "users" },
  { href: "/inbox", label: "Inbox", icon: "mail" },
  { href: "/team", label: "Team", icon: "briefcase" },
  { href: "/automations", label: "Automations", icon: "flow" },
  { href: "/reports", label: "Reports", icon: "trend" },
  { href: "/copilot", label: "AI Copilot", icon: "spark" },
] as const;

export const CAL_LINK = "the-hydro-dam/30min";

/** Customer-facing journey, mirrored in the client portal. */
export const JOURNEY = [
  "Assessment booked",
  "Assessment complete",
  "Quote prepared",
  "Quote approved",
  "Agreement signed",
  "Installation scheduled",
  "Installed",
] as const;

export const MESSAGE_TEMPLATES = [
  { key: "speed_to_lead", name: "Speed to lead", channel: "sms", body: "Thanks for reaching out to HydroDam, {{first_name}}. {{owner_name}} will call you within the hour to book your free assessment." },
  { key: "appointment_confirm", name: "Appointment confirmed", channel: "sms", body: "You're booked, {{first_name}} — {{visit_date}} between {{visit_window}}. Reply here if anything changes. — HydroDam" },
  { key: "reminder_24h", name: "24-hour reminder", channel: "sms", body: "Reminder: HydroDam is out to you tomorrow, {{visit_date}} at {{visit_window}}. Reply C to confirm." },
  { key: "on_my_way", name: "On my way", channel: "sms", body: "Good morning {{first_name}} — {{crew_name}} is on the way, ETA about {{eta}}. — HydroDam" },
  { key: "quote_sent", name: "Quote ready", channel: "sms", body: "Hi {{first_name}}, your quote {{quote_number}} is ready to view: {{portal_url}}" },
  { key: "quote_followup", name: "Quote follow-up", channel: "sms", body: "Hi {{first_name}} — following up on quote {{quote_number}}. Happy to walk through the options whenever suits. — HydroDam" },
  { key: "invoice_sent", name: "Invoice sent", channel: "email", body: "Your invoice {{invoice_number}} for {{balance}} is ready. Pay by bank transfer or card: {{portal_url}}" },
  { key: "review_request", name: "Review request", channel: "sms", body: "Thanks again, {{first_name}}. If the install went well, a quick Google review helps us more than anything: {{review_url}}" },
] as const;
