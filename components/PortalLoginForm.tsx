"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { sendPortalLink, signInToPortal } from "@/app/p/login/actions";

const FIELD =
  "mt-2 w-full rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal";
const LABEL = "block text-xs font-semibold uppercase tracking-wider text-ink-faint";

export function PortalLoginForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (result?.ok) {
    return (
      <div className="panel mt-6 flex items-start gap-3 rounded-2xl border-good/30 bg-good/10 p-5">
        <span className="mt-0.5 shrink-0 text-good"><Icon name="mail" size={18} /></span>
        <div>
          <p className="text-sm leading-relaxed text-good">{result.message}</p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="mt-2 text-xs text-ink-faint underline-offset-2 hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="panel mt-6 rounded-2xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await signInToPortal(email, password)));
      }}
    >
      <label className={LABEL} htmlFor="portal-email">Email address</label>
      <input
        id="portal-email"
        type="email"
        required
        autoComplete="username"
        inputMode="email"
        value={email}
        disabled={pending}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className={FIELD}
      />
      <label className={`${LABEL} mt-4`} htmlFor="portal-password">Password</label>
      <input
        id="portal-password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        disabled={pending}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD}
      />
      {result && !result.ok && <p className="mt-3 text-xs leading-relaxed text-bad">{result.message}</p>}
      <button
        type="submit"
        disabled={pending || !email || !password}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "One moment" : "Sign in"}
        {!pending && <Icon name="arrowRight" size={14} />}
      </button>
      <button
        type="button"
        disabled={pending || !email}
        onClick={() => startTransition(async () => setResult(await sendPortalLink(email)))}
        className="mt-4 block w-full text-center text-xs text-teal underline-offset-2 hover:underline disabled:opacity-50"
      >
        First time here, or forgot your password? Email me a link
      </button>
    </form>
  );
}
