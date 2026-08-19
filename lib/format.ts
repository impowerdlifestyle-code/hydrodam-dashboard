const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const USD_CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Money is stored in integer cents everywhere. Never format a raw number. */
export function money(cents: number, exact = false): string {
  return exact ? USD_CENTS.format(cents / 100) : USD.format(cents / 100);
}

export function compactMoney(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1_000) return `$${Math.round(d / 1_000)}k`;
  return USD.format(d);
}

export function pct(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}

const TZ = "America/New_York";

export function shortDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

export function longDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: TZ });
}

export function timeOfDay(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function dateTime(iso?: string): string {
  if (!iso) return "—";
  return `${shortDate(iso)}, ${timeOfDay(iso)}`;
}

export function timeRange(startISO: string, endISO: string): string {
  return `${timeOfDay(startISO)} – ${timeOfDay(endISO)}`;
}

export function relative(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60_000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins}m ago` : `in ${-mins}m`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return hrs > 0 ? `${hrs}h ago` : `in ${-hrs}h`;
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return days > 0 ? `${days}d ago` : `in ${-days}d`;
  return shortDate(iso);
}

export function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  return Math.round((Date.parse(dateStr) - Date.now()) / 86_400_000);
}

export function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function phoneDisplay(e164?: string): string {
  if (!e164) return "—";
  const d = e164.replace(/\D/g, "").replace(/^1/, "");
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------ calendar days in TZ */

/**
 * Every date boundary in this app is a boundary in HydroDam's timezone, not in
 * the server's. That distinction was invisible in development — a Mac set to
 * America/New_York gives the same answer either way — and wrong in production,
 * where Vercel runs in UTC. A 9am install rendered at 1pm on the dispatch
 * board, and an evening visit landed in the wrong day column entirely.
 *
 * So: no `getHours`, `getDay` or `toDateString` on a visit time. Compare day
 * keys, and take the hour from here.
 */

/** The calendar day in HydroDam's timezone, as YYYY-MM-DD. */
export function dayKey(value: string | Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export const todayKey = (): string => dayKey(new Date());

/** Hours past midnight in HydroDam's timezone, fractional. */
export function hoursInTz(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** Day-key arithmetic, anchored at noon UTC so a DST shift cannot skip a day. */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** 0 = Sunday, matching the dispatch board's columns. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export const startOfWeekKey = (key: string): string => addDaysKey(key, -weekdayOfKey(key));

/** Formats a day key without ever routing it back through a timezone. */
export function formatKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
