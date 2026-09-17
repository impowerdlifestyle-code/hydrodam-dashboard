"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { bookFromPortal, cancelBookingFromPortal } from "@/app/p/[token]/actions";
import type { SlotDay } from "@/lib/booking";

type Booked = { visitId: string; when: string; where?: string };

export function PortalBooking({
  token,
  days,
  needsAddress,
  booked,
}: {
  token?: string;
  days: SlotDay[];
  needsAddress: boolean;
  booked?: Booked;
}) {
  const router = useRouter();
  const [dayKey, setDayKey] = useState(days[0]?.key ?? "");
  const [startISO, setStartISO] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [pending, startTransition] = useTransition();

  const inert = !token;
  const day = days.find((d) => d.key === dayKey);

  if (booked && !changing) {
    return (
      <section className="panel mt-4 rounded-2xl border-line-bright p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-teal">Your on-site assessment</p>
        <p className="mt-2 font-display text-lg font-bold text-ink">{booked.when}</p>
        {booked.where && <p className="text-sm text-ink-dim">{booked.where}</p>}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          It takes about an hour. We measure every opening you want protected and confirm what the install involves.
          Please make sure we can reach each opening.
        </p>
        {result && <p className={`mt-3 text-xs ${result.ok ? "text-good" : "text-bad"}`}>{result.message}</p>}
        {!inert && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm("Cancel this booking? You can pick a new time straight after.")) return;
              startTransition(async () => {
                const r = await cancelBookingFromPortal(token!, booked.visitId);
                setResult(r);
                if (r.ok) {
                  setChanging(true);
                  router.refresh();
                }
              });
            }}
            className="mt-4 text-xs font-semibold text-ink-dim underline-offset-2 hover:underline disabled:opacity-50"
          >
            Need a different time? Cancel and rebook
          </button>
        )}
      </section>
    );
  }

  if (result?.ok && !changing) {
    return (
      <section className="panel mt-4 flex items-start gap-3 rounded-2xl border-good/30 bg-good/10 p-5">
        <span className="mt-0.5 shrink-0 text-good"><Icon name="check" size={18} /></span>
        <p className="text-sm leading-relaxed text-good">{result.message} A confirmation is on its way to your inbox.</p>
      </section>
    );
  }

  return (
    <section className="panel mt-4 rounded-2xl border-line-bright p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-teal">Book your free on-site assessment</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-dim">
        Pick a time that suits you. We come to you, measure every opening, and turn your ballpark into an itemized
        estimate. About an hour, no obligation.
      </p>

      {days.length === 0 ? (
        <p className="mt-4 rounded-xl border border-line/60 px-3 py-2.5 text-xs text-ink-dim">
          No online slots in the next few weeks. Call (727) 613-1415 and we will find a time.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                disabled={inert}
                onClick={() => { setDayKey(d.key); setStartISO(""); }}
                className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  d.key === dayKey ? "border-teal bg-teal/15 text-ink" : "border-line text-ink-dim hover:border-line-bright"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {day?.slots.map((s) => (
              <button
                key={s.startISO}
                type="button"
                disabled={inert}
                onClick={() => setStartISO(s.startISO)}
                className={`rounded-xl border py-2 text-sm transition-colors ${
                  s.startISO === startISO ? "border-teal bg-teal text-white" : "border-line text-ink hover:border-line-bright"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {needsAddress && (
        <div className="mt-4 grid gap-2 sm:grid-cols-6">
          <input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="Street address"
            autoComplete="street-address"
            disabled={inert}
            className="rounded-xl border border-line bg-black/20 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal sm:col-span-6"
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            autoComplete="address-level2"
            disabled={inert}
            className="rounded-xl border border-line bg-black/20 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal sm:col-span-4"
          />
          <input
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            placeholder="ZIP"
            inputMode="numeric"
            autoComplete="postal-code"
            disabled={inert}
            className="rounded-xl border border-line bg-black/20 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal sm:col-span-2"
          />
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything we should know? Gate code, parking, which openings worry you most."
        rows={2}
        disabled={inert}
        className="mt-2 w-full rounded-xl border border-line bg-black/20 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal"
      />

      {result && !result.ok && <p className="mt-3 text-xs text-bad">{result.message}</p>}

      <button
        type="button"
        disabled={inert || pending || !startISO || (needsAddress && (!line1 || !city || !postalCode))}
        onClick={() =>
          startTransition(async () => {
            const r = await bookFromPortal(token!, {
              startISO,
              notes,
              address: needsAddress ? { line1, city, postalCode } : undefined,
            });
            setResult(r);
            if (r.ok) {
              setChanging(false);
              router.refresh();
            }
          })
        }
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Booking" : "Confirm this time"}
        {!pending && <Icon name="calendar" size={14} />}
      </button>
      {inert && <p className="mt-2 text-center text-[11px] text-ink-faint">Booking is live on the customer&apos;s own link.</p>}
    </section>
  );
}
