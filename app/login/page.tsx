"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Login failed.");
      }
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm rounded-2xl p-8">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="font-display text-lg font-bold text-ink">HydroDam <span className="text-teal">Ops</span></span>
      </div>
      <h1 className="mt-6 text-xl font-bold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-dim">Enter your team access password.</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Access password"
        autoFocus
        className="mt-5 w-full rounded-xl border border-line bg-abyss-2 px-4 py-3 text-sm text-ink outline-none focus:border-teal"
      />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={loading || !password}
        className="mt-5 w-full rounded-xl bg-teal py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" fill="#1f8ab3" opacity="0.25" />
      <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z" stroke="#1f8ab3" strokeWidth="1.5" />
      <path d="M8 12h8M8 15h8" stroke="#cc551e" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
