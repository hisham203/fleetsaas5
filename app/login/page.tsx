"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLE_DESTINATIONS: Record<string, string> = {
  ADMIN: "/admin",
  DISPATCHER: "/dispatch",
  DRIVER: "/driver",
  CUSTOMER: "/b2b",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Login failed");
      return;
    }
    router.push(ROLE_DESTINATIONS[data.role] ?? "/");
  }

  return (
    <main className="min-h-screen bg-ink flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <p className="text-aqua text-sm font-mono tracking-widest uppercase mb-2">
          Fleet Ops
        </p>
        <h1 className="text-2xl font-semibold text-white mb-6">Sign in</h1>

        <form onSubmit={handleSubmit} className="bg-slate-850 rounded-xl border border-slate-750 p-5 space-y-3">
          <div>
            <label className="text-xs text-steel uppercase tracking-wide">Email</label>
            <input
              type="email"
              autoComplete="email"
              className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-steel uppercase tracking-wide">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
          <button
            type="submit"
            disabled={!email || !password || submitting}
            className="w-full bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-xs text-steel space-y-1">
          <p className="text-steel/70 uppercase tracking-wide mb-1">Demo credentials</p>
          <p>Admin: admin@demo-water.co / password123</p>
          <p>Dispatcher: dispatch@demo-water.co / password123</p>
          <p>Driver: khalid@demo-water.co / password123</p>
          <p>B2B Portal: portal@jarir-demo.co / password123</p>
          <p className="pt-1 border-t border-slate-750 mt-2">
            Second tenant (proves isolation): admin@acme-fuel-demo.co / password123
          </p>
          <p className="pt-1 border-t border-slate-750 mt-2 text-steel/70 uppercase tracking-wide">
            Riyadh Bulk Water Logistics (bulk tanker delivery pilot)
          </p>
          <p>Admin: admin@riyadh-bulk-water.co / password123</p>
          <p>Dispatcher: dispatch@riyadh-bulk-water.co / password123</p>
          <p>Driver: mohammed@riyadh-bulk-water.co / password123</p>
        </div>

        <p className="text-steel text-xs mt-4 text-center">
          New company?{" "}
          <a href="/signup" className="text-aqua hover:underline">Set up your account</a>
        </p>
      </div>
    </main>
  );
}
