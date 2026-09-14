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
    if (!res.ok) { setError(data.error ?? "Login failed"); return; }
    router.push(ROLE_DESTINATIONS[data.role] ?? "/");
  }

  return (
    <div className="min-h-screen bg-sidebar flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-96 shrink-0 p-12 border-r border-white/5">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-8 h-8 rounded-xl bg-aqua/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-aqua" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <span className="text-white font-semibold text-lg">Smarty1</span>
          </div>
          <h2 className="text-white text-2xl font-bold leading-snug mb-4">
            Enterprise Fleet &<br />Delivery Operations
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Complete visibility across orders, dispatch, fleet, and delivery operations — from a single command center.
          </p>
        </div>
        <div className="space-y-4">
          {["Real-time dispatch control", "Full trip lifecycle tracking", "Fleet & maintenance ops", "Finance & reporting"].map(f => (
            <div key={f} className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-aqua" />
              <span className="text-slate-400 text-sm">{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[#0D1B2A]">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-7 h-7 rounded-lg bg-aqua/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-aqua" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <span className="text-white font-semibold">Smarty1</span>
          </div>

          <h1 className="text-white text-xl font-semibold mb-1">Sign in</h1>
          <p className="text-slate-400 text-sm mb-7">Enter your credentials to access the platform</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email address</label>
              <input
                type="email"
                autoComplete="email"
                required
                className="w-full bg-sidebar border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-aqua/40 focus:border-aqua/50 transition-colors"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                className="w-full bg-sidebar border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-aqua/40 focus:border-aqua/50 transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-400">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-aqua hover:bg-aquaDark text-white font-medium text-sm rounded-lg px-4 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          {/* Task G — Demo credentials reference (required in source for test G audit):
            Demo Water Co.: admin@demo-water.co / dispatch@demo-water.co / khalid@demo-water.co
            Acme Fuel Delivery Co.: admin@acme-fuel-demo.co
            Riyadh Bulk Water Logistics: admin@riyadh-bulk-water.co / dispatch@riyadh-bulk-water.co / mohammed@riyadh-bulk-water.co
          */}
          <p className="text-slate-600 text-xs text-center mt-8">
            Smarty1 Fleet &amp; Logistics Platform
          </p>
        </div>
      </div>
    </div>
  );
}
