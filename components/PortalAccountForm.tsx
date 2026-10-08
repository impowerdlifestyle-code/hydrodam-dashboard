"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { savePortalPassword } from "@/app/p/[token]/actions";
import { PASSWORD_MIN } from "@/lib/portal-password";

const FIELD =
  "mt-2 w-full rounded-xl border border-line bg-black/20 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal";
const LABEL = "block text-xs font-semibold uppercase tracking-wider text-ink-faint";

export function PortalAccountForm({ token, email, mode }: { token: string; email: string; mode: "setup" | "reset" }) {
  const router = useRouter();
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const askEmail = mode === "setup" && !email;

  return (
    <form
      className="panel mt-6 rounded-2xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length < PASSWORD_MIN) return setError(`Please use at least ${PASSWORD_MIN} characters.`);
        if (password !== confirm) return setError("Those two passwords do not match.");
        setError(null);
        startTransition(async () => {
          const result = await savePortalPassword(token, password, askEmail ? typedEmail : undefined);
          if (!result.ok) return setError(result.message);
          if (mode === "reset") router.push(`/p/${token}`);
          else router.refresh();
        });
      }}
    >
      <label className={LABEL} htmlFor="portal-account-email">Email address</label>
      {askEmail ? (
        <input
          id="portal-account-email"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          value={typedEmail}
          disabled={pending}
          onChange={(e) => setTypedEmail(e.target.value)}
          placeholder="you@example.com"
          className={FIELD}
        />
      ) : (
        <input id="portal-account-email" type="email" readOnly autoComplete="username" value={email} className={`${FIELD} opacity-70`} />
      )}

      <label className={`${LABEL} mt-4`} htmlFor="portal-account-password">
        {mode === "setup" ? "Create a password" : "New password"}
      </label>
      <input
        id="portal-account-password"
        type={show ? "text" : "password"}
        required
        minLength={PASSWORD_MIN}
        autoComplete="new-password"
        value={password}
        disabled={pending}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD}
      />
      <p className="mt-1.5 text-xs text-ink-faint">At least {PASSWORD_MIN} characters.</p>

      <label className={`${LABEL} mt-4`} htmlFor="portal-account-confirm">Type it again</label>
      <input
        id="portal-account-confirm"
        type={show ? "text" : "password"}
        required
        autoComplete="new-password"
        value={confirm}
        disabled={pending}
        onChange={(e) => setConfirm(e.target.value)}
        className={FIELD}
      />

      <label className="mt-3 flex items-center gap-2 text-xs text-ink-dim">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show password
      </label>

      {error && <p className="mt-3 text-xs leading-relaxed text-bad">{error}</p>}
      <button
        type="submit"
        disabled={pending || !password || !confirm}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving" : mode === "setup" ? "Create my account" : "Save new password"}
        {!pending && <Icon name="arrowRight" size={14} />}
      </button>
    </form>
  );
}
