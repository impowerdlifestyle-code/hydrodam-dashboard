"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { buttonClass } from "@/components/ui";
import { OpsToast, useOps } from "@/components/Ops";
import type { InvoiceKind, OpeningType, PaymentMethod, Role, Series, VisitKind } from "@/lib/types";

/**
 * The forms behind the buttons.
 *
 * Kept deliberately plain: native inputs, no validation library, no optimistic
 * state. The database is the validator — it is the thing that knows an
 * installer is already booked at that hour — so these collect values, hand them
 * over, and show whatever comes back.
 */

const field =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-teal disabled:opacity-50";
const labelClass = "mb-1 block font-mono text-[10px] uppercase tracking-wider text-ink-faint";

export type Person = { id: string; name: string; color?: string };

/** `datetime-local` reads as local wall time, which is what a scheduler means. */
const toISO = (local: string): string => new Date(local).toISOString();

function defaultSlot(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CrewPicker({
  crew, selected, onToggle, disabled,
}: {
  crew: Person[]; selected: string[]; onToggle: (id: string) => void; disabled: boolean;
}) {
  if (crew.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        No crew on the team yet. Add people on the Team screen and they become assignable here.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {crew.map((p) => {
        const on = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(p.id)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
              on ? "border-teal bg-teal/10 text-teal" : "border-line text-ink-dim hover:border-line-bright"
            }`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

export function ScheduleVisitForm({
  jobId, requestId, crew, kinds,
}: {
  jobId?: string; requestId?: string; crew: Person[]; kinds: VisitKind[];
}) {
  const { run, pending, feedback } = useOps();
  const [start, setStart] = useState(defaultSlot());
  const [minutes, setMinutes] = useState(240);
  const [kind, setKind] = useState<VisitKind>(kinds[0]);
  const [staff, setStaff] = useState<string[]>([]);

  const toggle = (id: string) => setStaff((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {kinds.length > 1 && (
          <div>
            <span className={labelClass}>Visit</span>
            <select className={field} value={kind} disabled={pending} onChange={(e) => setKind(e.target.value as VisitKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <span className={labelClass}>Starts</span>
          <input type="datetime-local" className={field} value={start} disabled={pending} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Minutes</span>
          <input type="number" min={30} step={30} className={field} value={minutes} disabled={pending} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
      </div>

      <div>
        <span className={labelClass}>Crew</span>
        <CrewPicker crew={crew} selected={staff} onToggle={toggle} disabled={pending} />
      </div>

      <button
        type="button"
        disabled={pending || !start}
        className={buttonClass("primary", "sm")}
        onClick={() =>
          run(
            jobId
              ? { kind: "job.visit", id: jobId, visitKind: kind, startISO: toISO(start), minutes, staffIds: staff }
              : { kind: "request.schedule", id: requestId!, startISO: toISO(start), minutes, staffIds: staff }
          )
        }
      >
        <Icon name="calendar" size={13} />
        {pending ? "Booking…" : "Book it"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

export function RescheduleForm({ visitId, crew, current }: { visitId: string; crew: Person[]; current: string[] }) {
  const { run, pending, feedback } = useOps();
  const [start, setStart] = useState(defaultSlot());
  const [staff, setStaff] = useState<string[]>(current);

  const toggle = (id: string) => setStaff((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Move to</span>
        <input type="datetime-local" className={field} value={start} disabled={pending} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div>
        <span className={labelClass}>Crew</span>
        <CrewPicker crew={crew} selected={staff} onToggle={toggle} disabled={pending} />
      </div>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("outline", "sm")}
        onClick={() => run({ kind: "visit.move", id: visitId, startISO: toISO(start), staffIds: staff })}
      >
        {pending ? "Moving…" : "Reschedule"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "wire", label: "Wire" },
];

export function RecordPaymentForm({ invoiceId, balanceCents }: { invoiceId: string; balanceCents: number }) {
  const { run, pending, feedback } = useOps();
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [reference, setReference] = useState("");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <span className={labelClass}>Amount</span>
          <input type="number" min="0" step="0.01" className={field} value={amount} disabled={pending} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Method</span>
          <select className={field} value={method} disabled={pending} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={labelClass}>{method === "check" ? "Check no." : "Reference"}</span>
          <input className={field} value={reference} disabled={pending} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>

      {method === "card" && (
        <p className="text-xs leading-relaxed text-warn">
          Card costs 2.9% + 30¢ to receive. On a job this size that is real money — ACH is capped at $5.
        </p>
      )}

      <button
        type="button"
        disabled={pending}
        className={buttonClass("primary", "sm")}
        onClick={() =>
          run({
            kind: "invoice.pay",
            id: invoiceId,
            amountCents: Math.round(Number(amount) * 100),
            method,
            reference: reference.trim() || undefined,
          })
        }
      >
        <Icon name="dollar" size={13} />
        {pending ? "Recording…" : "Record payment"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

export function ApproveQuoteForm({ quoteId, suggested }: { quoteId: string; suggested: string }) {
  const { run, pending, feedback } = useOps();
  const [name, setName] = useState(suggested);

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Approved by</span>
        <input className={field} value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Full name of the person who agreed" />
      </div>
      <p className="text-xs leading-relaxed text-ink-faint">
        Recording an approval here writes a signature against the {" "}
        <span className="text-ink-dim">5-Year Limited Warranty and Purchase Agreement</span> in the
        customer&apos;s name. Only do this when they have actually agreed.
      </p>
      <button
        type="button"
        disabled={pending || name.trim().length < 2}
        className={buttonClass("primary", "sm")}
        onClick={() => run({ kind: "quote.approve", id: quoteId, signerName: name })}
      >
        <Icon name="check" size={13} />
        {pending ? "Recording…" : "Record approval"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

export function QuoteFromRequestForm({ requestId, openingCount }: { requestId: string; openingCount: number }) {
  const { run, pending, feedback } = useOps();
  const [series, setSeries] = useState<Series>("sentinel");

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Series</span>
        <select className={field} value={series} disabled={pending} onChange={(e) => setSeries(e.target.value as Series)}>
          <option value="sentinel">Sentinel</option>
          <option value="onyx">Onyx</option>
          <option value="titanium">Titanium (quote only)</option>
        </select>
      </div>
      <p className="text-xs text-ink-faint">
        Prices the {openingCount} opening{openingCount === 1 ? "" : "s"} on file at this property and
        opens the draft.
      </p>
      <button
        type="button"
        disabled={pending || openingCount === 0}
        className={buttonClass("primary", "sm")}
        onClick={() => run({ kind: "request.quote", id: requestId, series })}
      >
        <Icon name="file" size={13} />
        {pending ? "Pricing…" : "Draft a quote"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

const INVOICE_KINDS: { value: InvoiceKind; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "progress", label: "Progress" },
  { value: "final", label: "Balance / final" },
];

export function RaiseInvoiceForm({ jobId }: { jobId: string }) {
  const { run, pending, feedback } = useOps();
  const [kind, setKind] = useState<InvoiceKind>("deposit");

  return (
    <div className="space-y-3">
      <div>
        <span className={labelClass}>Invoice</span>
        <select className={field} value={kind} disabled={pending} onChange={(e) => setKind(e.target.value as InvoiceKind)}>
          {INVOICE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("primary", "sm")}
        onClick={() => run({ kind: "job.invoice", id: jobId, invoiceKind: kind })}
      >
        <Icon name="dollar" size={13} />
        {pending ? "Raising…" : "Raise invoice"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "crew", label: "Crew", hint: "Field app only. Cannot see money." },
  { value: "office", label: "Office", hint: "Everything except owner settings." },
  { value: "owner", label: "Owner", hint: "Full access." },
];

export function AddTeammateForm() {
  const { run, pending, feedback } = useOps();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("crew");
  const [rate, setRate] = useState("38.00");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={labelClass}>Name</span>
          <input className={field} value={name} disabled={pending} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Email</span>
          <input type="email" className={field} value={email} disabled={pending} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Mobile</span>
          <input className={field} value={phone} disabled={pending} onChange={(e) => setPhone(e.target.value)} placeholder="+1727…" />
        </div>
        <div>
          <span className={labelClass}>Role</span>
          <select className={field} value={role} disabled={pending} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={labelClass}>Cost rate $/hour</span>
          <input type="number" min="0" step="0.5" className={field} value={rate} disabled={pending} onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        {ROLES.find((r) => r.value === role)?.hint} The cost rate is snapshotted onto every time entry,
        so a later raise never rewrites the margin on a finished job.
      </p>

      <button
        type="button"
        disabled={pending || !name.trim() || !email.trim()}
        className={buttonClass("primary", "sm")}
        onClick={() =>
          run({
            kind: "team.add",
            name,
            email,
            phone: phone.trim() || undefined,
            role,
            hourlyCents: Math.round(Number(rate) * 100),
          })
        }
      >
        <Icon name="plus" size={13} />
        {pending ? "Adding…" : "Add to team"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

export function ClockControl({ userId, jobId, visitId, open }: { userId: string; jobId?: string; visitId?: string; open: boolean }) {
  const { run, pending, feedback } = useOps();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        className={buttonClass(open ? "danger" : "primary", "lg", true)}
        onClick={() => run(open ? { kind: "clock.out", userId } : { kind: "clock.in", userId, jobId, visitId })}
      >
        <Icon name="clock" size={16} />
        {pending ? "…" : open ? "Clock out" : "Clock in"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

export function CrewNotesForm({ visitId, current }: { visitId: string; current: string }) {
  const { run, pending, feedback } = useOps();
  const [notes, setNotes] = useState(current);

  return (
    <div className="space-y-2">
      <textarea
        rows={3}
        className={field}
        value={notes}
        disabled={pending}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What the office needs to know about this visit."
      />
      <button
        type="button"
        disabled={pending || notes === current}
        className={buttonClass("outline", "sm")}
        onClick={() => run({ kind: "visit.notes", id: visitId, notes })}
      >
        {pending ? "Saving…" : "Save notes"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

const ZONES = ["", "X", "AE", "A", "VE"];

export function PropertyForm({
  clientId, current,
}: {
  clientId: string;
  current?: { label?: string; address: string; city: string; postalCode: string; floodZone?: string; accessNotes?: string };
}) {
  const { run, pending, feedback } = useOps();
  const [address, setAddress] = useState(current?.address ?? "");
  const [city, setCity] = useState(current?.city ?? "");
  const [postalCode, setPostalCode] = useState(current?.postalCode ?? "");
  const [floodZone, setFloodZone] = useState(current?.floodZone ?? "");
  const [accessNotes, setAccessNotes] = useState(current?.accessNotes ?? "");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className={labelClass}>Street</span>
          <input className={field} value={address} disabled={pending} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>City</span>
          <input className={field} value={city} disabled={pending} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>ZIP</span>
          <input className={field} value={postalCode} disabled={pending} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
        <div>
          <span className={labelClass}>Flood zone</span>
          <select className={field} value={floodZone} disabled={pending} onChange={(e) => setFloodZone(e.target.value)}>
            {ZONES.map((z) => (
              <option key={z || "unknown"} value={z}>{z || "Unknown"}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <span className={labelClass}>Access notes</span>
          <textarea rows={2} className={field} value={accessNotes} disabled={pending} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Gate codes, HOA check-in, where to unload." />
        </div>
      </div>
      <button
        type="button"
        disabled={pending || !address.trim() || !city.trim() || !postalCode.trim()}
        className={buttonClass("primary", "sm")}
        onClick={() =>
          run({
            kind: "property.save",
            clientId,
            address,
            city,
            postalCode,
            floodZone: floodZone || undefined,
            accessNotes: accessNotes || undefined,
          })
        }
      >
        <Icon name="pin" size={13} />
        {pending ? "Saving…" : current ? "Update address" : "Save address"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}

const OPENING_TYPES: { value: OpeningType; label: string }[] = [
  { value: "door", label: "Door" },
  { value: "double_door", label: "Double door" },
  { value: "single_garage", label: "Single garage" },
  { value: "double_garage", label: "Double garage" },
  { value: "slider", label: "Slider" },
  { value: "storefront", label: "Storefront" },
  { value: "window", label: "Window" },
  { value: "custom", label: "Other" },
];

/**
 * The measurement that everything downstream depends on. Plank count comes
 * straight off the protection height, and anything wider than 9 ft picks up a
 * third post, so the preview shows both before anyone commits.
 */
export function OpeningForm({ propertyId }: { propertyId: string }) {
  const { run, pending, feedback } = useOps();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<OpeningType>("door");
  const [widthIn, setWidthIn] = useState("36");
  const [heightIn, setHeightIn] = useState("30");

  const w = Number(widthIn);
  const h = Number(heightIn);
  const planks = h > 0 ? Math.max(1, Math.ceil(h / 7.08)) : 0;
  const posts = w > 108 ? 3 : 2;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <span className={labelClass}>Opening</span>
          <input className={field} value={label} disabled={pending} onChange={(e) => setLabel(e.target.value)} placeholder="Front door" />
        </div>
        <div>
          <span className={labelClass}>Type</span>
          <select className={field} value={type} disabled={pending} onChange={(e) => setType(e.target.value as OpeningType)}>
            {OPENING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className={labelClass}>W (in)</span>
            <input type="number" min="1" step="0.5" className={field} value={widthIn} disabled={pending} onChange={(e) => setWidthIn(e.target.value)} />
          </div>
          <div>
            <span className={labelClass}>H (in)</span>
            <input type="number" min="1" step="0.5" className={field} value={heightIn} disabled={pending} onChange={(e) => setHeightIn(e.target.value)} />
          </div>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        {planks} plank{planks === 1 ? "" : "s"} · {posts} posts
        {posts === 3 && <span className="text-ember"> · centre post required over 9 ft</span>}
      </p>

      <button
        type="button"
        disabled={pending || !label.trim() || !(w > 0) || !(h > 0)}
        className={buttonClass("outline", "sm")}
        onClick={() =>
          run({ kind: "opening.add", propertyId, label, type, widthIn: w, protectionHeightIn: h })
        }
      >
        <Icon name="plus" size={13} />
        {pending ? "Adding…" : "Add opening"}
      </button>
      <OpsToast feedback={feedback} />
    </div>
  );
}
